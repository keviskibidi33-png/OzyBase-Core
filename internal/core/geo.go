package core

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"golang.org/x/text/language"
	"golang.org/x/text/language/display"
)

type GeoInfo struct {
	Country string  `json:"country"`
	City    string  `json:"city"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
}

type GeoService struct {
	db          *data.DB
	cache       sync.Map
	policyCache *GeoPolicy
	policyMu    sync.RWMutex
}

type GeoPolicy struct {
	Enabled          bool     `json:"enabled"`
	AllowedCountries []string `json:"allowed_countries"`
}

func NewGeoService(db *data.DB) *GeoService {
	return &GeoService{db: db}
}

func (s *GeoService) GetPolicy(ctx context.Context) (*GeoPolicy, error) {
	s.policyMu.RLock()
	if s.policyCache != nil {
		defer s.policyMu.RUnlock()
		return s.policyCache, nil
	}
	s.policyMu.RUnlock()

	s.policyMu.Lock()
	defer s.policyMu.Unlock()

	// Re-check after lock
	if s.policyCache != nil {
		return s.policyCache, nil
	}

	var configJSON []byte
	err := s.db.Pool.QueryRow(ctx, "SELECT config FROM _v_security_policies WHERE type = 'geo_fencing'").Scan(&configJSON)
	if err != nil {
		// Default policy if not found
		return &GeoPolicy{Enabled: false}, nil
	}

	var policy GeoPolicy
	if err := json.Unmarshal(configJSON, &policy); err != nil {
		return nil, err
	}

	s.policyCache = &policy
	return s.policyCache, nil
}

func (s *GeoService) InvalidatePolicy() {
	s.policyMu.Lock()
	s.policyCache = nil
	s.policyMu.Unlock()
}

func (s *GeoService) CheckBreach(ctx context.Context, ip string, country string) (bool, error) {
	policy, err := s.GetPolicy(ctx)
	if err != nil || !policy.Enabled {
		return false, err
	}

	if country == "Localhost" || country == "Internal" || country == "" {
		return false, nil
	}

	isAllowed := false
	for _, c := range policy.AllowedCountries {
		if geoCountryMatches(c, country) {
			isAllowed = true
			break
		}
	}

	return !isAllowed, nil
}

func geoCountryMatches(allowed string, actual string) bool {
	allowed = strings.TrimSpace(allowed)
	actual = strings.TrimSpace(actual)
	if allowed == "" || actual == "" {
		return false
	}
	if strings.EqualFold(allowed, actual) {
		return true
	}
	if normalizeGeoCountryLabel(allowed) == normalizeGeoCountryLabel(actual) {
		return true
	}

	if region, err := language.ParseRegion(strings.ToUpper(allowed)); err == nil {
		if displayName := strings.TrimSpace(display.English.Regions().Name(region)); displayName != "" {
			if strings.EqualFold(displayName, actual) || normalizeGeoCountryLabel(displayName) == normalizeGeoCountryLabel(actual) {
				return true
			}
		}
	}

	if region, err := language.ParseRegion(strings.ToUpper(actual)); err == nil {
		if displayName := strings.TrimSpace(display.English.Regions().Name(region)); displayName != "" {
			if strings.EqualFold(displayName, allowed) || normalizeGeoCountryLabel(displayName) == normalizeGeoCountryLabel(allowed) {
				return true
			}
		}
	}

	return false
}

func normalizeGeoCountryLabel(value string) string {
	var builder strings.Builder
	for _, r := range strings.TrimSpace(strings.ToLower(value)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func (s *GeoService) GetLocation(ctx context.Context, ip string) (GeoInfo, error) {
	// 1. Check in-memory cache
	if val, ok := s.cache.Load(ip); ok {
		return val.(GeoInfo), nil
	}

	// 2. Check DB cache
	var info GeoInfo
	err := s.db.Pool.QueryRow(ctx, `
		SELECT country, city, lat, lon FROM _v_ip_geo WHERE ip_address = $1
	`, ip).Scan(&info.Country, &info.City, &info.Lat, &info.Lon)

	if err == nil {
		s.cache.Store(ip, info)
		return info, nil
	}

	// 3. Fetch from API (ip-api.com)
	// Note: In production you might want a more robust service or local DB
	if ip == "127.0.0.1" || ip == "::1" || ip == "" {
		return GeoInfo{Country: "Localhost", City: "Internal"}, nil
	}

	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://ip-api.com/json/%s", ip))
	if err != nil {
		return GeoInfo{}, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("failed to close geo lookup response body for %s: %v", ip, closeErr)
		}
	}()

	var apiResp struct {
		Status  string  `json:"status"`
		Country string  `json:"country"`
		City    string  `json:"city"`
		Lat     float64 `json:"lat"`
		Lon     float64 `json:"lon"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return GeoInfo{}, err
	}

	if apiResp.Status != "success" {
		return GeoInfo{Country: "Unknown", City: "Unknown"}, nil
	}

	info = GeoInfo{
		Country: apiResp.Country,
		City:    apiResp.City,
		Lat:     apiResp.Lat,
		Lon:     apiResp.Lon,
	}

	// 4. Save to DB and memory cache
	go func() {
		bgCtx := context.Background()
		_, _ = s.db.Pool.Exec(bgCtx, `
			INSERT INTO _v_ip_geo (ip_address, country, city, lat, lon)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (ip_address) DO UPDATE SET last_updated = NOW()
		`, ip, info.Country, info.City, info.Lat, info.Lon)
	}()

	s.cache.Store(ip, info)
	return info, nil
}
