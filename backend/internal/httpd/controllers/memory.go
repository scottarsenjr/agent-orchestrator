package controllers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd/envelope"
	aoprocess "github.com/aoagents/agent-orchestrator/backend/internal/process"
	projectsvc "github.com/aoagents/agent-orchestrator/backend/internal/service/project"
	"github.com/go-chi/chi/v5"
)

type MemoryQuery struct {
	ProjectID    string `query:"projectId"`
	Scope        string `query:"scope"`
	SessionID    string `query:"sessionId"`
	Query        string `query:"query"`
	NodeTypes    string `query:"nodeTypes"`
	Statuses     string `query:"statuses"`
	MetadataOnly bool   `query:"metadataOnly"`
}
type MemoryNode struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	Label      string         `json:"label"`
	Content    string         `json:"content"`
	SourceID   string         `json:"source_id"`
	Date       string         `json:"date"`
	Status     string         `json:"status"`
	Provenance map[string]any `json:"provenance"`
}
type MemoryEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"type"`
}
type MemoryCounts struct {
	Visible  int `json:"visible"`
	Returned int `json:"returned"`
}
type MemoryContext struct {
	Branch string `json:"branch"`
	Commit string `json:"commit"`
	Dirty  bool   `json:"dirty"`
}
type MemoryGraph struct {
	SchemaVersion   int           `json:"schema_version"`
	ProjectID       string        `json:"project_id"`
	Workspace       string        `json:"workspace"`
	Context         MemoryContext `json:"context"`
	Revision        *string       `json:"revision"`
	VisibilityToken string        `json:"visibility_token"`
	Nodes           []MemoryNode  `json:"nodes"`
	Edges           []MemoryEdge  `json:"edges"`
	Counts          *MemoryCounts `json:"counts"`
	Truncated       bool          `json:"truncated"`
	EmptyReason     *string       `json:"empty_reason"`
	Errors          []string      `json:"errors"`
	MetadataOnly    bool          `json:"metadata_only"`
}

type MemoryController struct {
	Projects projectsvc.Manager
	Sessions SessionService
	Python   string
	command  func(context.Context, string, ...string) *exec.Cmd
}

func memoryCommand(ctx context.Context, python string, args ...string) *exec.Cmd {
	return aoprocess.CommandContext(ctx, python, args...)
}

func (c *MemoryController) resolveWorkspace(ctx context.Context, projectID, scope, sessionID string) (string, error) {
	project, err := c.Projects.Get(ctx, domain.ProjectID(projectID))
	if err != nil || project.Project == nil {
		return "", errors.New("project unavailable")
	}
	if scope == "project" {
		return project.Project.Path, nil
	}
	session, err := c.Sessions.GetRecord(ctx, domain.SessionID(sessionID))
	if err != nil || string(session.ProjectID) != projectID || session.Metadata.WorkspacePath == "" {
		return "", errors.New("session workspace unavailable")
	}
	return session.Metadata.WorkspacePath, nil
}

func (c *MemoryController) Register(r chi.Router) { r.Get("/memory/graph", c.graph) }

// boundedBuffer rejects output beyond the cap instead of allowing an untrusted
// subprocess to exhaust the daemon's memory.
type boundedBuffer struct{ bytes.Buffer }

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 4<<20 {
		return 0, errors.New("memory graph output too large")
	}
	return b.Buffer.Write(p)
}

func (c *MemoryController) graph(w http.ResponseWriter, r *http.Request) {
	bad := func(status int, msg string) {
		envelope.WriteAPIError(w, r, status, "bad_request", "MEMORY_UNAVAILABLE", msg, nil)
	}
	q := r.URL.Query()
	projectID := q.Get("projectId")
	scope := q.Get("scope")
	sessionID := q.Get("sessionId")
	if projectID == "" || (scope != "project" && scope != "worktree" && scope != "session") || (scope == "project" && sessionID != "") || (scope != "project" && sessionID == "") {
		bad(400, "Select a project and a valid scope.")
		return
	}
	if c.Projects == nil || c.Sessions == nil || c.Python == "" || !filepath.IsAbs(c.Python) {
		bad(503, "Memory is not configured.")
		return
	}
	workspace, err := c.resolveWorkspace(r.Context(), projectID, scope, sessionID)
	if err != nil {
		bad(404, "Project or session workspace is unavailable.")
		return
	}
	if !filepath.IsAbs(workspace) {
		bad(503, "Workspace is unavailable.")
		return
	}
	args := []string{"-X", "utf8", "-I", "-m", "jarvis_core.cli", "memory", "graph", "--workspace", workspace, "--json", "--limit", "200"}
	for _, entry := range []struct {
		key, flag string
		allowed   map[string]bool
	}{{"nodeTypes", "--node-types", map[string]bool{"source": true, "entity": true, "proposition": true}}, {"statuses", "--statuses", map[string]bool{"proposed": true, "implemented_in_branch": true, "accepted": true, "legacy": true}}} {
		if v := q.Get(entry.key); v != "" {
			for _, s := range strings.Split(v, ",") {
				if !entry.allowed[s] {
					bad(400, "Invalid memory filter.")
					return
				}
			}
			args = append(args, entry.flag, v)
		}
	}
	if text := q.Get("query"); text != "" {
		if len(text) > 512 {
			bad(400, "Search is too long.")
			return
		}
		args = append(args, "--query", text)
	}
	if q.Get("metadataOnly") != "" {
		value, err := strconv.ParseBool(q.Get("metadataOnly"))
		if err != nil {
			bad(400, "Invalid metadata flag.")
			return
		}
		if value {
			args = append(args, "--metadata-only")
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	command := c.command
	if command == nil {
		command = memoryCommand
	}
	cmd := command(ctx, c.Python, args...)
	cmd.Env = os.Environ()
	var out boundedBuffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		bad(503, "Memory provider is unavailable.")
		return
	}
	var graph MemoryGraph
	if json.Unmarshal(out.Bytes(), &graph) != nil || graph.SchemaVersion != 1 || graph.VisibilityToken == "" {
		bad(502, "Memory provider returned an invalid response.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	envelope.WriteJSON(w, http.StatusOK, graph)
}
