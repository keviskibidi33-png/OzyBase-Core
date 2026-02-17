package api

import (
	"net/http"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/labstack/echo/v4"
)

type WorkspaceHandler struct {
	service *core.WorkspaceService
	mailer  mailer.Mailer
}

func NewWorkspaceHandler(service *core.WorkspaceService, mailer mailer.Mailer) *WorkspaceHandler {
	return &WorkspaceHandler{service: service, mailer: mailer}
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

func (h *WorkspaceHandler) Update(c echo.Context) error {
	id := c.Param("id")
	var req struct {
		Name   string                 `json:"name"`
		Config map[string]interface{} `json:"config"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	if err := h.service.UpdateWorkspace(c.Request().Context(), id, req.Name, req.Config); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.NoContent(http.StatusOK)
}

func (h *WorkspaceHandler) Delete(c echo.Context) error {
	id := c.Param("id")
	if err := h.service.DeleteWorkspace(c.Request().Context(), id); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *WorkspaceHandler) ListMembers(c echo.Context) error {
	id := c.Param("id")
	members, err := h.service.GetWorkspaceMembers(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, members)
}

func (h *WorkspaceHandler) AddMember(c echo.Context) error {
	id := c.Param("id")
	var req struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	if err := h.service.AddWorkspaceMember(c.Request().Context(), id, req.UserID, req.Role); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Try to notify the user via email (async)
	go func() {
		// 1. Get user email and workspace name
		var email, workspaceName string
		err := h.service.GetDB().Pool.QueryRow(c.Request().Context(), `
			SELECT u.email, w.name 
			FROM _v_users u, _v_workspaces w 
			WHERE u.id = $1 AND w.id = $2
		`, req.UserID, id).Scan(&email, &workspaceName)

		if err == nil {
			inviterEmail, _ := c.Get("email").(string)
			if inviterEmail == "" {
				inviterEmail = "An admin"
			}
			_ = h.mailer.SendWorkspaceInvite(email, workspaceName, inviterEmail)
		}
	}()

	return c.NoContent(http.StatusOK)
}

func (h *WorkspaceHandler) RemoveMember(c echo.Context) error {
	id := c.Param("id")
	userId := c.Param("userId")
	if err := h.service.RemoveWorkspaceMember(c.Request().Context(), id, userId); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}
