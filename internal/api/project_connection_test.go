package api

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestConnectionConfigFromPoolConfig(t *testing.T) {
	poolConfig, err := pgxpool.ParseConfig("postgres://ozybase:secret@localhost:5433/ozybase?sslmode=require")
	if err != nil {
		t.Fatalf("ParseConfig failed: %v", err)
	}

	got := connectionConfigFromPoolConfig(poolConfig)
	if got.Host != "localhost" {
		t.Fatalf("expected host localhost, got %q", got.Host)
	}
	if got.Port != "5433" {
		t.Fatalf("expected port 5433, got %q", got.Port)
	}
	if got.User != "ozybase" {
		t.Fatalf("expected user ozybase, got %q", got.User)
	}
	if got.Database != "ozybase" {
		t.Fatalf("expected database ozybase, got %q", got.Database)
	}
	if got.SSLMode != "require" {
		t.Fatalf("expected sslmode require, got %q", got.SSLMode)
	}
}

func TestBuildConnectionURITemplate(t *testing.T) {
	got := buildConnectionURITemplate(databaseConnectionConfig{
		Host:     "localhost",
		Port:     "5433",
		User:     "ozybase",
		Database: "ozybase",
		SSLMode:  "disable",
	})

	want := "postgresql://ozybase:[YOUR-PASSWORD]@localhost:5433/ozybase?sslmode=disable"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestBuildConnectionURITemplateReturnsEmptyWhenConnectionIsIncomplete(t *testing.T) {
	got := buildConnectionURITemplate(databaseConnectionConfig{
		Host:     "localhost",
		Port:     "5433",
		User:     "ozybase",
		Database: "",
	})

	if got != "" {
		t.Fatalf("expected empty URI template, got %q", got)
	}
}

func TestResolvePoolerConnectionConfig(t *testing.T) {
	t.Setenv("DB_POOLER_URL", "postgres://pooler_user:secret@pool.internal:6543/ozy_pool?sslmode=require")

	got := resolvePoolerConnectionConfig()
	if got.Host != "pool.internal" {
		t.Fatalf("expected host pool.internal, got %q", got.Host)
	}
	if got.Port != "6543" {
		t.Fatalf("expected port 6543, got %q", got.Port)
	}
	if got.User != "pooler_user" {
		t.Fatalf("expected user pooler_user, got %q", got.User)
	}
	if got.Database != "ozy_pool" {
		t.Fatalf("expected database ozy_pool, got %q", got.Database)
	}
	if got.SSLMode != "require" {
		t.Fatalf("expected sslmode require, got %q", got.SSLMode)
	}
}
