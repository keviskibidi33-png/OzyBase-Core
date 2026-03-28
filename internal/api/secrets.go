package api

import (
	"context"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

type Secret struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	Value       string    `json:"value"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

// VAULT HANDLERS
func (h *Handler) ListSecrets(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Pool.Query(ctx, "SELECT id, key, value, description, created_at FROM _v_secrets ORDER BY key ASC")
	if err != nil {
		return c.JSON(http.StatusOK, []Secret{})
	}
	defer rows.Close()

	var secrets []Secret
	for rows.Next() {
		var s Secret
		if err := rows.Scan(&s.ID, &s.Key, &s.Value, &s.Description, &s.CreatedAt); err != nil {
			continue
		}
		secrets = append(secrets, s)
	}

	if secrets == nil {
		secrets = []Secret{}
	}

	return c.JSON(http.StatusOK, secrets)
}

func (h *Handler) CreateSecret(c echo.Context) error {
	var input struct {
		Key         string `json:"key"`
		Value       string `json:"value"`
		Description string `json:"description"`
	}
	if err := c.Bind(&input); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, "INSERT INTO _v_secrets (key, value, description) VALUES ($1, $2, $3)", input.Key, input.Value, input.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.NoContent(http.StatusCreated)
}

func (h *Handler) DeleteSecret(c echo.Context) error {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, "DELETE FROM _v_secrets WHERE id = $1", id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusOK)
}
