package api

import (
	"path/filepath"
	"testing"
)

func TestPreferredStaticDistDir(t *testing.T) {
	t.Run("uses explicit dist dir when configured", func(t *testing.T) {
		t.Setenv("OZY_FRONTEND_DIST_DIR", "/tmp/ozy-dist")
		t.Setenv("DEBUG", "false")

		if got := preferredStaticDistDir(); got != "/tmp/ozy-dist" {
			t.Fatalf("preferredStaticDistDir() = %q, want %q", got, "/tmp/ozy-dist")
		}
	})

	t.Run("uses frontend dist in debug mode", func(t *testing.T) {
		t.Setenv("OZY_FRONTEND_DIST_DIR", "")
		t.Setenv("DEBUG", "true")

		want := filepath.Join("frontend", "dist")
		if got := preferredStaticDistDir(); got != want {
			t.Fatalf("preferredStaticDistDir() = %q, want %q", got, want)
		}
	})

	t.Run("falls back to embedded mode outside debug", func(t *testing.T) {
		t.Setenv("OZY_FRONTEND_DIST_DIR", "")
		t.Setenv("DEBUG", "false")

		if got := preferredStaticDistDir(); got != "" {
			t.Fatalf("preferredStaticDistDir() = %q, want empty string", got)
		}
	})
}
