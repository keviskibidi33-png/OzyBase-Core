package migrations

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Generator handles the creation of SQL migration files
type Generator struct {
	MigrationsPath string
}

// NewGenerator creates a new migration generator
func NewGenerator(path string) *Generator {
	if path == "" {
		path = "./migrations"
	}
	_ = os.MkdirAll(path, 0755)
	return &Generator{MigrationsPath: path}
}

// CreateMigration generates a new .sql file with the given name and content
func (g *Generator) CreateMigration(name string, sql string) (fileName string, err error) {
	timestamp := time.Now().Format("20060102150405")
	fileName = fmt.Sprintf("%s_%s.sql", timestamp, name)
	filePath := filepath.Join(g.MigrationsPath, fileName)

	// Create file
	f, err := os.Create(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to create migration file: %w", err)
	}
	defer func() {
		if closeErr := f.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("failed to close migration file: %w", closeErr)
		}
	}()

	// Write SQL content
	_, err = fmt.Fprintf(f, "-- OzyBase Auto-Generated Migration\n-- Description: %s\n\n%s", name, sql)
	if err != nil {
		return "", fmt.Errorf("failed to write migration content: %w", err)
	}

	return fileName, nil
}
