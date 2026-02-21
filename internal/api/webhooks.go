package api

import (
	"net/http"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/security"
	"github.com/labstack/echo/v4"
)

type WebhookInfo struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	URL      string `json:"url"`
	Events   string `json:"events"`
	Secret   string `json:"secret,omitempty"`
	IsActive bool   `json:"is_active"`
}

type WebhookHandler struct {
	DB *data.DB
}

func NewWebhookHandler(db *data.DB) *WebhookHandler {
	return &WebhookHandler{DB: db}
}

func (h *WebhookHandler) List(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT id, name, url, events, secret, is_active FROM _v_webhooks ORDER BY created_at DESC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var webhooks []WebhookInfo
	for rows.Next() {
		var w WebhookInfo
		var secret *string
		if err := rows.Scan(&w.ID, &w.Name, &w.URL, &w.Events, &secret, &w.IsActive); err == nil {
			if secret != nil {
				w.Secret = *secret
			}
			webhooks = append(webhooks, w)
		}
	}

	if webhooks == nil {
		webhooks = []WebhookInfo{}
	}

	return c.JSON(http.StatusOK, webhooks)
}

func (h *WebhookHandler) Create(c echo.Context) error {
	var req struct {
		Name   string `json:"name"`
		URL    string `json:"url"`
		Events string `json:"events"`
		Secret string `json:"secret"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}
	if req.Name == "" || req.URL == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name and url are required"})
	}
	if _, err := security.ValidateOutboundURL(req.URL, security.OutboundURLOptions{
		AllowHTTP:           false,
		AllowPrivateNetwork: security.AllowPrivateOutboundFromEnv(),
	}); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid webhook url: " + err.Error()})
	}

	var id string
	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_webhooks (name, url, events, secret)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, req.Name, req.URL, req.Events, req.Secret).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]string{"id": id, "message": "Webhook created"})
}

func (h *WebhookHandler) Delete(c echo.Context) error {
	id := c.Param("id")
	_, err := h.DB.Pool.Exec(c.Request().Context(), "DELETE FROM _v_webhooks WHERE id = $1", id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}
