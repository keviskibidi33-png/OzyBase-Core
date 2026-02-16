package core

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
)

// AuditService handles asynchronous log buffering and persistence
type AuditService struct {
	db        *data.DB
	logChan   chan data.AuditLog
	batchSize int
	shutdown  chan struct{}
	wg        sync.WaitGroup
}

// NewAuditService creates a new AuditService
func NewAuditService(db *data.DB) *AuditService {
	return &AuditService{
		db:        db,
		logChan:   make(chan data.AuditLog, 2000), // Buffer suitable for high throughput
		batchSize: 50,                             // Insert in batches of 50
		shutdown:  make(chan struct{}),
	}
}

// Start spawns the background worker
func (s *AuditService) Start() {
	s.wg.Add(1)
	go s.process()
	fmt.Println("🚀 [Audit] Worker started")
}

// Stop gracefully shuts down the worker, flushing remaining logs
func (s *AuditService) Stop() {
	fmt.Println("🛑 [Audit] Worker stopping...")
	close(s.shutdown)
	s.wg.Wait()
	fmt.Println("✅ [Audit] Worker stopped")
}

// Log adds a new log entry to the buffer
func (s *AuditService) Log(log data.AuditLog) {
	select {
	case s.logChan <- log:
	default:
		// Drop log if buffer full to prevent blocking API (Load shedding)
		fmt.Fprintf(os.Stderr, "⚠️ [Audit] Buffer full, dropping log: %s\n", log.Path)
	}
}

func (s *AuditService) process() {
	defer s.wg.Done()
	buffer := make([]data.AuditLog, 0, s.batchSize)
	ticker := time.NewTicker(1 * time.Second) // Flush at least every second
	defer ticker.Stop()

	flush := func() {
		if len(buffer) > 0 {
			// Using BulkInsert for high performance
			if err := s.db.BulkInsertAuditLogs(context.Background(), buffer); err != nil {
				fmt.Fprintf(os.Stderr, "❌ [Audit] Bulk insert failed: %v\n", err)
			}
			buffer = buffer[:0]
		}
	}

	for {
		select {
		case log := <-s.logChan:
			buffer = append(buffer, log)
			if len(buffer) >= s.batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		case <-s.shutdown:
			flush()
			return
		}
	}
}
