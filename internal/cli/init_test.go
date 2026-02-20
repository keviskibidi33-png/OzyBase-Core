package cli

import "testing"

func TestNormalizeDatabaseURL_LocalDefaultDisable(t *testing.T) {
	got, sslmode, err := normalizeDatabaseURL("postgres://user:pass@db:5432/ozybase")
	if err != nil {
		t.Fatalf("normalizeDatabaseURL() error = %v", err)
	}
	if sslmode != "disable" {
		t.Fatalf("expected sslmode disable, got %q", sslmode)
	}
	if got != "postgres://user:pass@db:5432/ozybase?sslmode=disable" {
		t.Fatalf("unexpected URL: %s", got)
	}
}

func TestNormalizeDatabaseURL_ExternalDefaultRequire(t *testing.T) {
	got, sslmode, err := normalizeDatabaseURL("postgres://user:pass@db.example.com:5432/ozybase")
	if err != nil {
		t.Fatalf("normalizeDatabaseURL() error = %v", err)
	}
	if sslmode != "require" {
		t.Fatalf("expected sslmode require, got %q", sslmode)
	}
	if got != "postgres://user:pass@db.example.com:5432/ozybase?sslmode=require" {
		t.Fatalf("unexpected URL: %s", got)
	}
}

func TestNormalizeDatabaseURL_ExternalDisableGetsHardened(t *testing.T) {
	got, sslmode, err := normalizeDatabaseURL("postgres://user:pass@db.example.com:5432/ozybase?sslmode=disable")
	if err != nil {
		t.Fatalf("normalizeDatabaseURL() error = %v", err)
	}
	if sslmode != "require" {
		t.Fatalf("expected sslmode require, got %q", sslmode)
	}
	if got != "postgres://user:pass@db.example.com:5432/ozybase?sslmode=require" {
		t.Fatalf("unexpected URL: %s", got)
	}
}
