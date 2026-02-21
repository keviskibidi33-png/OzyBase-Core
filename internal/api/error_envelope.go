package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

const requestIDContextKey = "request_id"

type envelopeContext struct {
	echo.Context
}

// RequestIDMiddleware guarantees every request has a stable request_id value.
func RequestIDMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			reqID := strings.TrimSpace(c.Request().Header.Get(echo.HeaderXRequestID))
			if reqID == "" {
				reqID = uuid.NewString()
			}

			c.Set(requestIDContextKey, reqID)
			c.Response().Header().Set(echo.HeaderXRequestID, reqID)
			return next(c)
		}
	}
}

// ErrorEnvelopeMiddleware normalizes all JSON error payloads to:
// { "error": "...", "error_code": "...", "request_id": "..." }.
func ErrorEnvelopeMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			return next(&envelopeContext{Context: c})
		}
	}
}

func (c *envelopeContext) JSON(code int, i interface{}) error {
	if code < http.StatusBadRequest {
		return c.Context.JSON(code, i)
	}
	return c.Context.JSON(code, normalizeErrorPayload(c.Context, code, i))
}

// HTTPErrorHandler provides a global fallback envelope for unhandled errors.
func HTTPErrorHandler(err error, c echo.Context) {
	if c.Response().Committed {
		return
	}

	status := http.StatusInternalServerError
	message := http.StatusText(http.StatusInternalServerError)
	errorCode := inferErrorCode(status)

	if he, ok := err.(*echo.HTTPError); ok {
		status = he.Code
		errorCode = inferErrorCode(status)
		if status < http.StatusInternalServerError {
			switch msg := he.Message.(type) {
			case string:
				message = strings.TrimSpace(msg)
			case error:
				message = strings.TrimSpace(msg.Error())
			default:
				message = strings.TrimSpace(fmt.Sprint(msg))
			}
		}
	}

	if message == "" {
		message = http.StatusText(status)
	}

	payload := map[string]any{
		"error":      message,
		"error_code": errorCode,
		"request_id": RequestIDFromContext(c),
	}
	_ = c.JSON(status, payload)
}

// RequestIDFromContext returns current request id from context or response header.
func RequestIDFromContext(c echo.Context) string {
	if c == nil {
		return ""
	}
	if reqID, ok := c.Get(requestIDContextKey).(string); ok && strings.TrimSpace(reqID) != "" {
		return strings.TrimSpace(reqID)
	}
	return strings.TrimSpace(c.Response().Header().Get(echo.HeaderXRequestID))
}

func normalizeErrorPayload(c echo.Context, status int, payload interface{}) map[string]any {
	result := map[string]any{}

	switch v := payload.(type) {
	case map[string]any:
		for key, value := range v {
			result[key] = value
		}
	case map[string]string:
		for key, value := range v {
			result[key] = value
		}
	case error:
		result["error"] = v.Error()
	case string:
		result["error"] = v
	default:
		result["error"] = http.StatusText(status)
	}

	if _, ok := result["error"]; !ok {
		if msg, exists := result["message"]; exists {
			result["error"] = fmt.Sprint(msg)
		} else {
			result["error"] = http.StatusText(status)
		}
	}

	if _, ok := result["error_code"]; !ok {
		result["error_code"] = inferErrorCode(status)
	}

	result["request_id"] = RequestIDFromContext(c)
	return result
}

func inferErrorCode(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "BAD_REQUEST"
	case http.StatusUnauthorized:
		return "UNAUTHORIZED"
	case http.StatusForbidden:
		return "FORBIDDEN"
	case http.StatusNotFound:
		return "NOT_FOUND"
	case http.StatusConflict:
		return "CONFLICT"
	case http.StatusUnprocessableEntity:
		return "UNPROCESSABLE_ENTITY"
	case http.StatusTooManyRequests:
		return "RATE_LIMITED"
	default:
		if status >= http.StatusInternalServerError {
			return "INTERNAL_ERROR"
		}
		return "API_ERROR"
	}
}
