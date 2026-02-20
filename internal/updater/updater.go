package updater

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const defaultRepo = "Xangel0s/OzyBase"

type releaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

type releaseResponse struct {
	TagName string         `json:"tag_name"`
	Assets  []releaseAsset `json:"assets"`
}

// Options configures upgrade behavior.
type Options struct {
	Repo    string
	Version string
}

// Upgrade downloads and installs the latest release binary for the current OS/ARCH.
func Upgrade(opts Options) (string, error) {
	repo := opts.Repo
	if repo == "" {
		repo = defaultRepo
	}

	release, err := fetchRelease(repo, opts.Version)
	if err != nil {
		return "", err
	}

	assetName, archiveName := expectedAssetNames(release.TagName)
	assetURL := findAssetURL(release.Assets, archiveName)
	if assetURL == "" {
		return "", fmt.Errorf("release %s has no asset %q", release.TagName, archiveName)
	}

	tmpDir, err := os.MkdirTemp("", "ozybase-upgrade-*")
	if err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	archivePath := filepath.Join(tmpDir, archiveName)
	if err := downloadFile(assetURL, archivePath); err != nil {
		return "", err
	}

	binPath, err := extractBinary(archivePath, tmpDir, assetName)
	if err != nil {
		return "", err
	}

	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve current executable: %w", err)
	}
	exePath, err = filepath.Abs(exePath)
	if err != nil {
		return "", fmt.Errorf("resolve absolute executable path: %w", err)
	}

	installedPath, err := installBinary(binPath, exePath)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("upgraded to %s (%s)", release.TagName, installedPath), nil
}

func fetchRelease(repo, version string) (*releaseResponse, error) {
	endpoint := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	if version != "" {
		tag := version
		if !strings.HasPrefix(tag, "v") {
			tag = "v" + tag
		}
		endpoint = fmt.Sprintf("https://api.github.com/repos/%s/releases/tags/%s", repo, tag)
	}

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build release request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "ozybase-upgrader")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch release metadata: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("release metadata request failed: %s (%s)", resp.Status, strings.TrimSpace(string(body)))
	}

	var out releaseResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode release metadata: %w", err)
	}
	if out.TagName == "" {
		return nil, errors.New("release metadata missing tag_name")
	}
	return &out, nil
}

func expectedAssetNames(tag string) (string, string) {
	base := strings.TrimPrefix(tag, "v")
	bin := "ozybase"
	if runtime.GOOS == "windows" {
		bin = "ozybase.exe"
	}
	archive := fmt.Sprintf("ozybase_%s_%s_%s.tar.gz", base, runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		archive = fmt.Sprintf("ozybase_%s_%s_%s.zip", base, runtime.GOOS, runtime.GOARCH)
	}
	return bin, archive
}

func findAssetURL(assets []releaseAsset, name string) string {
	for _, a := range assets {
		if a.Name == name {
			return a.URL
		}
	}
	return ""
}

func downloadFile(url, dest string) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build download request: %w", err)
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("User-Agent", "ozybase-upgrader")

	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("download archive: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("archive download failed: %s (%s)", resp.Status, strings.TrimSpace(string(body)))
	}

	out, err := os.Create(dest)
	if err != nil {
		return fmt.Errorf("create archive file: %w", err)
	}
	defer out.Close()

	if _, err := io.Copy(out, resp.Body); err != nil {
		return fmt.Errorf("write archive file: %w", err)
	}
	return nil
}

func extractBinary(archivePath, outDir, binaryName string) (string, error) {
	if strings.HasSuffix(archivePath, ".zip") {
		return extractZipBinary(archivePath, outDir, binaryName)
	}
	return extractTarGzBinary(archivePath, outDir, binaryName)
}

func extractZipBinary(archivePath, outDir, binaryName string) (string, error) {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", fmt.Errorf("open zip archive: %w", err)
	}
	defer r.Close()

	for _, f := range r.File {
		if filepath.Base(f.Name) != binaryName {
			continue
		}
		src, err := f.Open()
		if err != nil {
			return "", fmt.Errorf("open zip binary: %w", err)
		}
		defer src.Close()

		destPath := filepath.Join(outDir, binaryName)
		dst, err := os.Create(destPath)
		if err != nil {
			return "", fmt.Errorf("create extracted binary: %w", err)
		}
		if _, err := io.Copy(dst, src); err != nil {
			_ = dst.Close()
			return "", fmt.Errorf("extract zip binary: %w", err)
		}
		if err := dst.Close(); err != nil {
			return "", fmt.Errorf("close extracted binary: %w", err)
		}
		return destPath, nil
	}

	return "", fmt.Errorf("binary %q not found in zip archive", binaryName)
}

func extractTarGzBinary(archivePath, outDir, binaryName string) (string, error) {
	f, err := os.Open(archivePath)
	if err != nil {
		return "", fmt.Errorf("open archive: %w", err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", fmt.Errorf("open gzip stream: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("read tar entry: %w", err)
		}
		if filepath.Base(hdr.Name) != binaryName {
			continue
		}

		destPath := filepath.Join(outDir, binaryName)
		dst, err := os.Create(destPath)
		if err != nil {
			return "", fmt.Errorf("create extracted binary: %w", err)
		}
		if _, err := io.Copy(dst, tr); err != nil {
			_ = dst.Close()
			return "", fmt.Errorf("extract tar binary: %w", err)
		}
		if err := dst.Close(); err != nil {
			return "", fmt.Errorf("close extracted binary: %w", err)
		}
		return destPath, nil
	}

	return "", fmt.Errorf("binary %q not found in tar.gz archive", binaryName)
}

func installBinary(newBinaryPath, currentExecutablePath string) (string, error) {
	data, err := os.ReadFile(newBinaryPath)
	if err != nil {
		return "", fmt.Errorf("read extracted binary: %w", err)
	}

	if runtime.GOOS == "windows" {
		newPath := currentExecutablePath + ".new.exe"
		if err := os.WriteFile(newPath, data, 0o755); err != nil {
			return "", fmt.Errorf("write replacement binary: %w", err)
		}
		return newPath, nil
	}

	tmpPath := currentExecutablePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o755); err != nil {
		return "", fmt.Errorf("write temporary binary: %w", err)
	}
	if err := os.Rename(tmpPath, currentExecutablePath); err != nil {
		return "", fmt.Errorf("replace binary: %w", err)
	}

	return currentExecutablePath, nil
}
