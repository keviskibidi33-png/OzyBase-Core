package storage

import (
	"context"
	"io"
)

// ACL represents access control list for storage
type ACL string

const (
	ACLPublicRead ACL = "public-read"
	ACLPrivate    ACL = "private"
	ACLAuthRead   ACL = "auth-read"
)

// Provider defines the interface for different storage backends
type Provider interface {
	Upload(ctx context.Context, bucket, key string, reader io.Reader, size int64, contentType string, acl ACL) error
	Download(ctx context.Context, bucket, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, bucket, key string) error
	GetURL(ctx context.Context, bucket, key string) (string, error)
	Health(ctx context.Context) error
}
