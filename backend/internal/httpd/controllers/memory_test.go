package controllers

import (
	"context"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	projectsvc "github.com/aoagents/agent-orchestrator/backend/internal/service/project"
)

type memoryProjects struct {
	projectsvc.Manager
	path string
}

func (p memoryProjects) Get(_ context.Context, id domain.ProjectID) (projectsvc.GetResult, error) {
	return projectsvc.GetResult{Project: &projectsvc.Project{ID: id, Path: p.path}}, nil
}

type memorySessions struct {
	SessionService
	project domain.ProjectID
	path    string
}

func (s memorySessions) GetRecord(_ context.Context, id domain.SessionID) (domain.SessionRecord, error) {
	return domain.SessionRecord{ID: id, ProjectID: s.project, Metadata: domain.SessionMetadata{WorkspacePath: s.path}}, nil
}

func TestMemoryRejectsWrongScopeAndInvalidFilters(t *testing.T) {
	root := t.TempDir()
	c := MemoryController{Projects: memoryProjects{path: root}, Sessions: memorySessions{project: "other", path: root}, Python: filepath.Join(root, "missing.exe")}
	for _, target := range []struct {
		query string
		want  int
	}{
		{"?projectId=p&scope=session&sessionId=s", 404},
		{"?projectId=p&scope=project&sessionId=s", 400},
		{"?projectId=p&scope=project&nodeTypes=source,invalid", 400},
		{"?projectId=p&scope=project&statuses=accepted,invalid", 400},
		{"?projectId=p&scope=project&metadataOnly=maybe", 400},
	} {
		t.Run(target.query, func(t *testing.T) {
			w := httptest.NewRecorder()
			c.graph(w, httptest.NewRequest("GET", "/memory/graph"+target.query, nil))
			if w.Code != target.want {
				t.Fatalf("got %d, want %d", w.Code, target.want)
			}
		})
	}
}
