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
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/security"
)

const defaultRepo = "Xangel0s/OzyBase"

var repoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

type releaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

type releaseResponse struct {
	TagName string         `json:"tag_name"`
	HTMLURL string         `json:"html_url"`
	Assets  []releaseAsset `json:"assets"`
}

type ReleaseMetadata struct {
	TagName string
	HTMLURL string
}

func DefaultRepo() string {
	return defaultRepo
}

func LatestRelease(repo string) (ReleaseMetadata, error) {
	if repo == "" {
		repo = defaultRepo
	}

	release, err := fetchRelease(repo, "")
	if err != nil {
		return ReleaseMetadata{}, err
	}

	return ReleaseMetadata{
		TagName: release.TagName,
		HTMLURL: release.HTMLURL,
	}, nil
}

// Options configures upgrade behavior.
type Options struct {
	Repo    string
	Version string
}

// Upgrade downloads and installs the latest release binary for the current OS/ARCH.
func Upgrade(opts Options) (message string, err error) {
	repo := opts.Repo
	if repo == "" {
		repo = defaultRepo
	}
	if !repoPattern.MatchString(repo) {
		return "", fmt.Errorf("invalid repository format")
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
	defer removeAllIntoErr(tmpDir, &err)

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

	message = fmt.Sprintf("upgraded to %s (%s)", release.TagName, installedPath)
	return message, nil
}

func fetchRelease(repo, version string) (release *releaseResponse, err error) {
	endpoint := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	if version != "" {
		tag := version
		if !strings.HasPrefix(tag, "v") {
			tag = "v" + tag
		}
		endpoint = fmt.Sprintf("https://api.github.com/repos/%s/releases/tags/%s", repo, tag)
	}
	if _, err := security.ValidateOutboundURL(endpoint, security.OutboundURLOptions{
		AllowHTTP: false,
		AllowedHosts: map[string]struct{}{
			"api.github.com": {},
		},
	}); err != nil {
		return nil, fmt.Errorf("invalid release endpoint: %w", err)
	}

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build release request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "ozybase-upgrader")

	client := &http.Client{Timeout: 30 * time.Second}
	// #nosec G704 -- endpoint is constrained to api.github.com via ValidateOutboundURL.
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch release metadata: %w", err)
	}
	defer closeIntoErr("release metadata response body", resp.Body, &err)

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("release metadata request failed: %s (%s)", resp.Status, strings.TrimSpace(string(body)))
	}

	var out releaseResponse
	if err = json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode release metadata: %w", err)
	}
	if out.TagName == "" {
		return nil, errors.New("release metadata missing tag_name")
	}
	release = &out
	return release, nil
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

func downloadFile(url, dest string) (err error) {
	if _, err := security.ValidateOutboundURL(url, security.OutboundURLOptions{
		AllowHTTP: false,
		AllowedHosts: map[string]struct{}{
			"github.com":                            {},
			"api.github.com":                        {},
			"objects.githubusercontent.com":         {},
			"release-assets.githubusercontent.com":  {},
			"github-releases.githubusercontent.com": {},
			"codeload.github.com":                   {},
		},
	}); err != nil {
		return fmt.Errorf("invalid download url: %w", err)
	}

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build download request: %w", err)
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("User-Agent", "ozybase-upgrader")

	client := &http.Client{Timeout: 2 * time.Minute}
	// #nosec G704 -- download URL is validated against strict GitHub host allowlist.
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("download archive: %w", err)
	}
	defer closeIntoErr("archive response body", resp.Body, &err)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("archive download failed: %s (%s)", resp.Status, strings.TrimSpace(string(body)))
	}

	out, err := os.Create(dest)
	if err != nil {
		return fmt.Errorf("create archive file: %w", err)
	}
	defer closeIntoErr("archive file", out, &err)

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

func extractZipBinary(archivePath, outDir, binaryName string) (destPath string, err error) {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", fmt.Errorf("open zip archive: %w", err)
	}
	defer closeIntoErr("zip archive", r, &err)

	for _, f := range r.File {
		if filepath.Base(f.Name) != binaryName {
			continue
		}
		src, err := f.Open()
		if err != nil {
			return "", fmt.Errorf("open zip binary: %w", err)
		}
		defer closeIntoErr("zip binary", src, &err)

		destPath = filepath.Join(outDir, binaryName)
		dst, err := os.Create(destPath)
		if err != nil {
			return "", fmt.Errorf("create extracted binary: %w", err)
		}
		defer closeIntoErr("extracted binary", dst, &err)
		if _, err := io.Copy(dst, src); err != nil {
			return "", fmt.Errorf("extract zip binary: %w", err)
		}
		return destPath, nil
	}

	return "", fmt.Errorf("binary %q not found in zip archive", binaryName)
}

func extractTarGzBinary(archivePath, outDir, binaryName string) (destPath string, err error) {
	f, err := os.Open(archivePath)
	if err != nil {
		return "", fmt.Errorf("open archive: %w", err)
	}
	defer closeIntoErr("archive file", f, &err)

	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", fmt.Errorf("open gzip stream: %w", err)
	}
	defer closeIntoErr("gzip stream", gz, &err)

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

		destPath = filepath.Join(outDir, binaryName)
		dst, err := os.Create(destPath)
		if err != nil {
			return "", fmt.Errorf("create extracted binary: %w", err)
		}
		defer closeIntoErr("extracted binary", dst, &err)
		if _, err := io.Copy(dst, tr); err != nil {
			return "", fmt.Errorf("extract tar binary: %w", err)
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

func closeIntoErr(name string, closer io.Closer, errp *error) {
	if closeErr := closer.Close(); closeErr != nil && *errp == nil {
		*errp = fmt.Errorf("close %s: %w", name, closeErr)
	}
}

func removeAllIntoErr(path string, errp *error) {
	if removeErr := os.RemoveAll(path); removeErr != nil && *errp == nil {
		*errp = fmt.Errorf("remove temp dir: %w", removeErr)
	}
}
