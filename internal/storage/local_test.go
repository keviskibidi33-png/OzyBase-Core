package storage

import (
	"bytes"
	"context"
	"testing"
)

func TestLocalProviderUploadRejectsSizeMismatch(t *testing.T) {
	t.Parallel()

	provider := NewLocalProvider(t.TempDir())
	err := provider.Upload(context.Background(), "docs", "file.bin", bytes.NewReader([]byte("hello world")), 5, "application/octet-stream", ACLPrivate)
	if err == nil {
		t.Fatal("expected upload size mismatch error")
	}
}
