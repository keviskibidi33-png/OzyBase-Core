package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type LocalProvider struct {
	basePath string
}

func NewLocalProvider(basePath string) *LocalProvider {
	_ = os.MkdirAll(basePath, 0o750)
	return &LocalProvider{basePath: basePath}
}

func (l *LocalProvider) Upload(ctx context.Context, bucket, key string, reader io.Reader, size int64, contentType string, acl ACL) (err error) {
	path, err := l.resolvePath(bucket, key)
	if err != nil {
		return err
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o750)

	// #nosec G304 -- path is constrained by resolvePath to remain under basePath.
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := f.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close local upload file: %w", closeErr)
		}
		if err != nil {
			_ = os.Remove(path)
		}
	}()

	written, err := io.Copy(f, reader)
	if err != nil {
		return err
	}
	if size >= 0 && written != size {
		return fmt.Errorf("local upload size mismatch: wrote %d bytes, expected %d", written, size)
	}
	return nil
}

func (l *LocalProvider) Download(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	path, err := l.resolvePath(bucket, key)
	if err != nil {
		return nil, err
	}
	// #nosec G304 -- path is constrained by resolvePath to remain under basePath.
	return os.Open(path)
}

func (l *LocalProvider) Delete(ctx context.Context, bucket, key string) error {
	path, err := l.resolvePath(bucket, key)
	if err != nil {
		return err
	}
	return os.Remove(path)
}

func (l *LocalProvider) GetURL(ctx context.Context, bucket, key string) (string, error) {
	if _, err := l.resolvePath(bucket, key); err != nil {
		return "", err
	}
	// Usually served by the app itself
	return fmt.Sprintf("/api/files/%s/%s", bucket, key), nil
}

func (l *LocalProvider) Health(ctx context.Context) error {
	if err := os.MkdirAll(l.basePath, 0o750); err != nil {
		return err
	}
	testFile := filepath.Join(l.basePath, ".healthcheck")
	f, err := os.OpenFile(testFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_ = f.Close()
	_ = os.Remove(testFile)
	return nil
}

func (l *LocalProvider) resolvePath(bucket, key string) (string, error) {
	bucket = strings.TrimSpace(bucket)
	key = strings.TrimSpace(key)
	if bucket == "" || key == "" {
		return "", errors.New("bucket and key are required")
	}
	if strings.ContainsAny(bucket, `/\`) || strings.Contains(bucket, "..") {
		return "", errors.New("invalid bucket")
	}

	cleanKey := filepath.Clean(key)
	if cleanKey == "." || cleanKey == "" || filepath.IsAbs(cleanKey) || strings.HasPrefix(cleanKey, "..") {
		return "", errors.New("invalid key")
	}

	baseAbs, err := filepath.Abs(l.basePath)
	if err != nil {
		return "", err
	}
	fullAbs, err := filepath.Abs(filepath.Join(baseAbs, bucket, cleanKey))
	if err != nil {
		return "", err
	}

	if fullAbs != baseAbs && !strings.HasPrefix(fullAbs, baseAbs+string(os.PathSeparator)) {
		return "", errors.New("invalid storage path")
	}

	return fullAbs, nil
}
