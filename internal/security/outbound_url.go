package security

import (
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"os"
	"strings"
)

// OutboundURLOptions defines validation rules for outbound HTTP destinations.
type OutboundURLOptions struct {
	AllowHTTP           bool
	AllowPrivateNetwork bool
	AllowedHosts        map[string]struct{}
}

// AllowPrivateOutboundFromEnv enables private-network outbound requests when explicitly requested.
func AllowPrivateOutboundFromEnv() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("OZY_ALLOW_PRIVATE_OUTBOUND")), "true")
}

// ValidateOutboundURL validates outbound URLs before using them in HTTP clients.
func ValidateOutboundURL(raw string, opts OutboundURLOptions) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("url is required")
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	if parsed.Hostname() == "" {
		return nil, fmt.Errorf("url host is required")
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && !(opts.AllowHTTP && scheme == "http") {
		return nil, fmt.Errorf("only https is allowed")
	}

	host := strings.ToLower(parsed.Hostname())
	if len(opts.AllowedHosts) > 0 {
		if _, ok := opts.AllowedHosts[host]; !ok {
			return nil, fmt.Errorf("host %q is not allowed", host)
		}
	}

	if !opts.AllowPrivateNetwork {
		if isPrivateHostname(host) {
			return nil, fmt.Errorf("private host %q is not allowed", host)
		}

		if ip := net.ParseIP(host); ip != nil && isPrivateOrSpecialIP(ip) {
			return nil, fmt.Errorf("private address %q is not allowed", host)
		}
	}

	return parsed, nil
}

func isPrivateHostname(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return host == "localhost" ||
		host == "host.docker.internal" ||
		host == "kubernetes.docker.internal" ||
		strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".local")
}

func isPrivateOrSpecialIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	return addr.IsPrivate() ||
		addr.IsLoopback() ||
		addr.IsLinkLocalMulticast() ||
		addr.IsLinkLocalUnicast() ||
		addr.IsMulticast() ||
		addr.IsUnspecified()
}
