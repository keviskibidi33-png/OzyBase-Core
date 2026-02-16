package api

import (
	"net/http"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/labstack/echo/v4"
)

type WorkspaceHandler struct {
	service *core.WorkspaceService
}

func NewWorkspaceHandler(service *core.WorkspaceService) *WorkspaceHandler {
	return &WorkspaceHandler{service: service}
}

func (h *WorkspaceHandler) Create(c echo.Context) error {
	userID := c.Get("user_id").(string)
	var req struct {
		Name string `json:"name"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name is required"})
	}

	ws, err := h.service.CreateWorkspace(c.Request().Context(), req.Name, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, ws)
}

func (h *WorkspaceHandler) List(c echo.Context) error {
	userID := c.Get("user_id").(string)
	workspaces, err := h.service.ListWorkspacesForUser(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, workspaces)
}
