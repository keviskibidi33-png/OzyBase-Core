package api

import (
	"context"
	"errors"
	"testing"
)

func TestRunHealthCheck(t *testing.T) {
	okCheck := runHealthCheck(context.Background(), func(ctx context.Context) error {
		return nil
	})
	if okCheck.Status != "ok" {
		t.Fatalf("expected ok status, got %s", okCheck.Status)
	}
	if okCheck.LatencyMS < 0 {
		t.Fatalf("expected non-negative latency")
	}

	failCheck := runHealthCheck(context.Background(), func(ctx context.Context) error {
		return errors.New("boom")
	})
	if failCheck.Status != "fail" {
		t.Fatalf("expected fail status, got %s", failCheck.Status)
	}
	if failCheck.Error == "" {
		t.Fatalf("expected failure error message")
	}
}

func TestCoverageRatio(t *testing.T) {
	if ratio := coverageRatio(0, 0); ratio != 1 {
		t.Fatalf("expected 1 when total is zero, got %f", ratio)
	}
	if ratio := coverageRatio(3, 4); ratio != 0.75 {
		t.Fatalf("expected 0.75, got %f", ratio)
	}
}
