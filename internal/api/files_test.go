package api

import (
	"strings"
	"testing"
	"time"

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

func TestValidateBucketUploadSize(t *testing.T) {
	t.Parallel()

	bucket := bucketRecord{Name: "docs", MaxFileSizeBytes: 5 * 1024 * 1024}
	assert.NoError(t, validateBucketUploadSize(bucket, 1024))
	assert.ErrorContains(t, validateBucketUploadSize(bucket, 6*1024*1024), "file exceeds bucket limit")
}

func TestValidateBucketTotalQuota(t *testing.T) {
	t.Parallel()

	bucket := bucketRecord{Name: "docs", TotalSize: 9 * 1024 * 1024, MaxTotalSizeBytes: 10 * 1024 * 1024}
	assert.NoError(t, validateBucketTotalQuota(bucket, 512))
	assert.ErrorContains(t, validateBucketTotalQuota(bucket, 2*1024*1024), "bucket exceeds total quota")
}

func TestMultipartPartSize(t *testing.T) {
	t.Parallel()

	totalSize := int64(25 * 1024 * 1024)
	chunkSize := int64(8 * 1024 * 1024)
	assert.Equal(t, 4, multipartTotalParts(totalSize, chunkSize))
	assert.Equal(t, chunkSize, multipartPartSize(totalSize, chunkSize, 1))
	assert.Equal(t, chunkSize, multipartPartSize(totalSize, chunkSize, 3))
	assert.Equal(t, int64(1*1024*1024), multipartPartSize(totalSize, chunkSize, 4))
}

func TestRecommendedMultipartChunkSize(t *testing.T) {
	t.Parallel()

	assert.Equal(t, storageMultipartChunkSize, recommendedMultipartChunkSize(128*1024*1024))
	assert.Equal(t, int64(16*1024*1024), recommendedMultipartChunkSize(512*1024*1024))
	assert.Equal(t, int64(32*1024*1024), recommendedMultipartChunkSize(2*1024*1024*1024))
	assert.Equal(t, storageMultipartThreshold, recommendedMultipartChunkSize(5*1024*1024*1024))
}

func TestMultipartSessionTTL(t *testing.T) {
	t.Parallel()

	assert.Equal(t, storageMultipartMinSessionTTL, multipartSessionTTL(128*1024*1024, storageMultipartChunkSize))

	longTTL := multipartSessionTTL(5*1024*1024*1024, storageMultipartThreshold)
	assert.GreaterOrEqual(t, longTTL, 50*time.Minute)
	assert.LessOrEqual(t, longTTL, storageMultipartMaxSessionTTL)
}

func TestStorageUploadTokenRoundTrip(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.March, 31, 10, 0, 0, 0, time.UTC)
	token, err := issueStorageUploadToken("test-secret", "session-123", now, now.Add(10*time.Minute))
	assert.NoError(t, err)

	claims, err := validateStorageUploadToken("test-secret", token, now.Add(5*time.Minute))
	assert.NoError(t, err)
	assert.Equal(t, "session-123", claims.SessionID)
	assert.Equal(t, "storage-upload", claims.Scope)
}

func TestStorageUploadTokenRejectsExpired(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.March, 31, 10, 0, 0, 0, time.UTC)
	token, err := issueStorageUploadToken("test-secret", "session-123", now, now.Add(1*time.Minute))
	assert.NoError(t, err)

	_, err = validateStorageUploadToken("test-secret", token, now.Add(2*time.Minute))
	assert.Error(t, err)
}
