package api

import (
	"context"
	"net/http"
	"net/mail"
	"strings"
	"time"

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

func workspaceActorID(c echo.Context) (string, bool) {
	userID, ok := c.Get("user_id").(string)
	if !ok || strings.TrimSpace(userID) == "" {
		return "", false
	}
	return userID, true
}

func (h *WorkspaceHandler) requireWorkspaceRole(c echo.Context, workspaceID string) (string, bool, error) {
	userID, ok := workspaceActorID(c)
	if !ok {
		return "", false, c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}

	isMember, role, err := h.service.IsMember(c.Request().Context(), workspaceID, userID)
	if err != nil {
		return "", false, c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if !isMember {
		return "", false, c.JSON(http.StatusForbidden, map[string]string{"error": "workspace access denied"})
	}
	return role, true, nil
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
	role, ok, err := h.requireWorkspaceRole(c, id)
	if err != nil || !ok {
		return err
	}
	if !canManageWorkspaceSettings(role) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace settings require admin or owner access"})
	}

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
	role, ok, err := h.requireWorkspaceRole(c, id)
	if err != nil || !ok {
		return err
	}
	if !canDeleteWorkspace(role) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace deletion requires owner access"})
	}

	if err := h.service.DeleteWorkspace(c.Request().Context(), id); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *WorkspaceHandler) ListMembers(c echo.Context) error {
	id := c.Param("id")
	role, ok, err := h.requireWorkspaceRole(c, id)
	if err != nil || !ok {
		return err
	}
	if !canViewWorkspaceMembers(role) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace members are not visible for this role"})
	}

	members, err := h.service.GetWorkspaceMembers(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, members)
}

func (h *WorkspaceHandler) AddMember(c echo.Context) error {
	id := c.Param("id")
	actorUserID, ok := workspaceActorID(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}
	actorRole, isAuthorized, err := h.requireWorkspaceRole(c, id)
	if err != nil || !isAuthorized {
		return err
	}
	if !canManageWorkspaceSettings(actorRole) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace membership changes require admin or owner access"})
	}

	var req struct {
		UserID string `json:"user_id"`
		Email  string `json:"email"`
		Role   string `json:"role"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	targetUserID := strings.TrimSpace(req.UserID)
	targetEmail := strings.TrimSpace(strings.ToLower(req.Email))
	if targetUserID == "" && targetEmail == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "user_id or email is required"})
	}

	req.Role = normalizeWorkspaceRole(req.Role)
	if !isManagedWorkspaceRole(req.Role) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "role must be admin, member, or viewer"})
	}
	if !canAssignWorkspaceRole(actorRole, req.Role) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "your workspace role cannot assign that target role"})
	}

	if targetUserID == "" {
		if _, err := mail.ParseAddress(targetEmail); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid email"})
		}

		if err := h.service.GetDB().Pool.QueryRow(c.Request().Context(), `
			SELECT id
			FROM _v_users
			WHERE LOWER(email) = $1
		`, targetEmail).Scan(&targetUserID); err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "user not found"})
		}
	}

	if targetUserID == actorUserID && normalizeWorkspaceRole(actorRole) == workspaceRoleAdmin {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "admins cannot change their own workspace role"})
	}

	targetIsMember, targetRole, err := h.service.IsMember(c.Request().Context(), id, targetUserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if targetIsMember {
		if normalizeWorkspaceRole(targetRole) == workspaceRoleOwner {
			return c.JSON(http.StatusConflict, map[string]string{"error": "workspace owner cannot be changed from member settings"})
		}
		if !canManageWorkspaceMember(actorRole, targetRole) {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "your workspace role cannot manage that member"})
		}
	}

	if err := h.service.AddWorkspaceMember(c.Request().Context(), id, targetUserID, req.Role); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	inviterEmail, _ := c.Get("email").(string)
	if inviterEmail == "" {
		inviterEmail = "An admin"
	}

	// Notify the invited user asynchronously without depending on the request context.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		var email, workspaceName string
		err := h.service.GetDB().Pool.QueryRow(ctx, `
			SELECT u.email, w.name 
			FROM _v_users u, _v_workspaces w 
			WHERE u.id = $1 AND w.id = $2
		`, targetUserID, id).Scan(&email, &workspaceName)

		if err == nil {
			_ = mailer.SendTemplateEmail(ctx, h.service.GetDB(), h.mailer, "workspace_invite", email, map[string]string{
				"app_name":       "OzyBase",
				"workspace_name": workspaceName,
				"inviter_email":  inviterEmail,
			})
		}
	}()

	return c.NoContent(http.StatusOK)
}

func (h *WorkspaceHandler) RemoveMember(c echo.Context) error {
	id := c.Param("id")
	userId := c.Param("userId")
	actorUserID, ok := workspaceActorID(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}
	actorRole, isAuthorized, err := h.requireWorkspaceRole(c, id)
	if err != nil || !isAuthorized {
		return err
	}
	if !canManageWorkspaceSettings(actorRole) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace membership changes require admin or owner access"})
	}

	targetIsMember, targetRole, err := h.service.IsMember(c.Request().Context(), id, userId)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if !targetIsMember {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "workspace member not found"})
	}
	if normalizeWorkspaceRole(targetRole) == workspaceRoleOwner {
		return c.JSON(http.StatusConflict, map[string]string{"error": "workspace owner cannot be removed"})
	}
	if actorUserID == userId && normalizeWorkspaceRole(actorRole) == workspaceRoleAdmin {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "admins cannot remove themselves from the workspace"})
	}
	if !canManageWorkspaceMember(actorRole, targetRole) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "your workspace role cannot manage that member"})
	}

	if err := h.service.RemoveWorkspaceMember(c.Request().Context(), id, userId); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}
