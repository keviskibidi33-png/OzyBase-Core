package core

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

// SaveFile saves a multipart file to the destination path with a unique name
func SaveFile(fileHeader *multipart.FileHeader, storageDir string) (savedName string, err error) {
	// Create storage directory if it doesn't exist
	if err := os.MkdirAll(filepath.Clean(storageDir), 0750); err != nil {
		return "", fmt.Errorf("failed to create storage directory: %w", err)
	}

	// Open the source file
	src, err := fileHeader.Open()
	if err != nil {
		return "", fmt.Errorf("failed to open uploaded file: %w", err)
	}
	defer func() {
		if closeErr := src.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("failed to close uploaded file: %w", closeErr)
		}
	}()

	// Generate a unique filename: UUID_originalName
	uniqueID := uuid.New().String()
	safeFilename := fmt.Sprintf("%s_%s", uniqueID, fileHeader.Filename)
	destPath := filepath.Join(storageDir, safeFilename)

	// Create the destination file
	dst, err := os.Create(filepath.Clean(destPath))
	if err != nil {
		return "", fmt.Errorf("failed to create destination file: %w", err)
	}
	defer func() {
		if closeErr := dst.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("failed to close destination file: %w", closeErr)
		}
	}()

	// Copy the contents
	if _, err = io.Copy(dst, src); err != nil {
		return "", fmt.Errorf("failed to copy file contents: %w", err)
	}

	savedName = safeFilename
	return savedName, nil
}

// FileInfo represents basic file metadata
type FileInfo struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	Path string `json:"path"`
}

// ListFiles returns a list of files in the storage directory
func ListFiles(storageDir string) ([]FileInfo, error) {
	entries, err := os.ReadDir(storageDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []FileInfo{}, nil
		}
		return nil, err
	}

	var files []FileInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				continue
			}
			files = append(files, FileInfo{
				Name: entry.Name(),
				Size: info.Size(),
				Path: "/api/files/" + entry.Name(),
			})
		}
	}
	return files, nil
}
