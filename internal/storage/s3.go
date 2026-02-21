package storage

import (
	"context"
	"io"
	"net/url"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type S3Provider struct {
	client *minio.Client
}

func NewS3Provider(endpoint, accessKey, secretKey string, useSSL bool) (*S3Provider, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}
	return &S3Provider{client: client}, nil
}

func (s *S3Provider) Upload(ctx context.Context, bucket, key string, reader io.Reader, size int64, contentType string, acl ACL) error {
	// Create bucket if not exists
	exists, err := s.client.BucketExists(ctx, bucket)
	if err != nil {
		return err
	}
	if !exists {
		err = s.client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{})
		if err != nil {
			return err
		}
	}

	_, err = s.client.PutObject(ctx, bucket, key, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
		// In S3-compatible, ACLs are often handled via bucket policies or metadata
		UserMetadata: map[string]string{"x-amz-acl": string(acl)},
	})
	return err
}

func (s *S3Provider) Download(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	return s.client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
}

func (s *S3Provider) Delete(ctx context.Context, bucket, key string) error {
	return s.client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
}

func (s *S3Provider) GetURL(ctx context.Context, bucket, key string) (string, error) {
	// For S3, we can generate a presigned URL or a direct URL if public
	reqParams := make(url.Values)
	presignedURL, err := s.client.PresignedGetObject(ctx, bucket, key, 24*3600, reqParams)
	if err != nil {
		return "", err
	}
	return presignedURL.String(), nil
}

func (s *S3Provider) Health(ctx context.Context) error {
	_, err := s.client.ListBuckets(ctx)
	return err
}
