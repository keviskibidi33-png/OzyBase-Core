package api

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestResolveObjectStorageKey(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		bucket     string
		storedPath string
		wantKey    string
		wantLegacy bool
	}{
		{
			name:       "new object key only",
			bucket:     "avatars",
			storedPath: "abc123_photo.png",
			wantKey:    "abc123_photo.png",
			wantLegacy: false,
		},
		{
			name:       "bucket prefixed path",
			bucket:     "avatars",
			storedPath: "avatars/abc123_photo.png",
			wantKey:    "abc123_photo.png",
			wantLegacy: false,
		},
		{
			name:       "new routed path",
			bucket:     "avatars",
			storedPath: "/api/files/avatars/abc123_photo.png",
			wantKey:    "abc123_photo.png",
			wantLegacy: false,
		},
		{
			name:       "legacy flat path",
			bucket:     "avatars",
			storedPath: "/api/files/legacy.png",
			wantKey:    "legacy.png",
			wantLegacy: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			gotKey, gotLegacy := resolveObjectStorageKey(tt.bucket, tt.storedPath)

			assert.Equal(t, tt.wantKey, gotKey)
			assert.Equal(t, tt.wantLegacy, gotLegacy)
		})
	}
}

func TestBuildObjectStorageKey(t *testing.T) {
	t.Parallel()

	key := buildObjectStorageKey("My Report 2026.pdf")

	assert.True(t, strings.HasSuffix(key, "_my-report-2026.pdf"))
	assert.Len(t, strings.SplitN(key, "_", 2), 2)
}
