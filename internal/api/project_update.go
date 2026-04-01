package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/updater"
	"github.com/Xangel0s/OzyBase/internal/version"
	"github.com/labstack/echo/v4"
)

const projectUpdateCacheTTL = 30 * time.Minute

type ProjectUpdateStatus struct {
	Repository      string `json:"repository"`
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version,omitempty"`
	UpdateAvailable bool   `json:"update_available"`
	Status          string `json:"status"`
	Message         string `json:"message"`
	ReleaseURL      string `json:"release_url,omitempty"`
	CheckedAt       string `json:"checked_at"`
}

func (h *Handler) GetProjectUpdateStatus(c echo.Context) error {
	forceRefresh := strings.EqualFold(strings.TrimSpace(c.QueryParam("refresh")), "true")
	if !forceRefresh {
		if cached, ok := h.getCachedProjectUpdateStatus(); ok {
			return c.JSON(http.StatusOK, cached)
		}
	}

	status := ProjectUpdateStatus{
		Repository:     updater.DefaultRepo(),
		CurrentVersion: version.Version,
		Status:         "unknown",
		Message:        "Unable to determine release status.",
		CheckedAt:      time.Now().UTC().Format(time.RFC3339),
	}

	release, err := updater.LatestRelease(status.Repository)
	if err != nil {
		status.Status = "unreachable"
		status.Message = "GitHub release metadata is not reachable from this runtime."
		h.setCachedProjectUpdateStatus(status, 5*time.Minute)
		return c.JSON(http.StatusOK, status)
	}

	status.LatestVersion = release.TagName
	status.ReleaseURL = release.HTMLURL
	status.UpdateAvailable = isReleaseNewer(version.Version, release.TagName)

	switch {
	case strings.EqualFold(strings.TrimSpace(version.Version), "dev"):
		status.Status = "development"
		status.Message = "This instance is running a development build."
	case status.UpdateAvailable:
		status.Status = "update_available"
		status.Message = "A newer OzyBase Core release is available."
	default:
		status.Status = "current"
		status.Message = "This instance is already on the latest tagged release."
	}

	h.setCachedProjectUpdateStatus(status, projectUpdateCacheTTL)
	return c.JSON(http.StatusOK, status)
}

func (h *Handler) getCachedProjectUpdateStatus() (ProjectUpdateStatus, bool) {
	h.updateStatusCacheMu.RLock()
	defer h.updateStatusCacheMu.RUnlock()
	if h.updateStatusCache == nil || time.Now().After(h.updateStatusCacheUntil) {
		return ProjectUpdateStatus{}, false
	}
	return *h.updateStatusCache, true
}

func (h *Handler) setCachedProjectUpdateStatus(status ProjectUpdateStatus, ttl time.Duration) {
	h.updateStatusCacheMu.Lock()
	defer h.updateStatusCacheMu.Unlock()
	h.updateStatusCache = &status
	h.updateStatusCacheUntil = time.Now().Add(ttl)
}

func normalizeReleaseVersion(raw string) []int {
	value := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(raw, "v"), "V"))
	if value == "" || strings.EqualFold(value, "dev") {
		return nil
	}

	parts := strings.Split(value, ".")
	out := make([]int, 0, 3)
	for _, part := range parts {
		if len(out) == 3 {
			break
		}
		numeric := 0
		for _, ch := range part {
			if ch < '0' || ch > '9' {
				break
			}
			numeric = (numeric * 10) + int(ch-'0')
		}
		out = append(out, numeric)
	}
	for len(out) < 3 {
		out = append(out, 0)
	}
	return out
}

func isReleaseNewer(current, latest string) bool {
	currentParts := normalizeReleaseVersion(current)
	latestParts := normalizeReleaseVersion(latest)
	if len(currentParts) == 0 || len(latestParts) == 0 {
		return false
	}

	for index := 0; index < 3; index += 1 {
		if latestParts[index] > currentParts[index] {
			return true
		}
		if latestParts[index] < currentParts[index] {
			return false
		}
	}

	return false
}
