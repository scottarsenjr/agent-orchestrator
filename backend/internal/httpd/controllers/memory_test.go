package controllers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd/envelope"
	projectsvc "github.com/aoagents/agent-orchestrator/backend/internal/service/project"
	sessionsvc "github.com/aoagents/agent-orchestrator/backend/internal/service/session"
	"github.com/aoagents/agent-orchestrator/backend/internal/storage/sqlite/sqlitetest"
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
		query    string
		want     int
		wantKind string
	}{
		{"?projectId=p&scope=session&sessionId=s", 404, "not_found"},
		{"?projectId=p&scope=project&sessionId=s", 400, "bad_request"},
		{"?projectId=p&scope=project&nodeTypes=source,invalid", 400, "bad_request"},
		{"?projectId=p&scope=project&statuses=accepted,invalid", 400, "bad_request"},
		{"?projectId=p&scope=project&metadataOnly=maybe", 400, "bad_request"},
		{"?projectId=p&scope=project", 503, "unavailable"},
	} {
		t.Run(target.query, func(t *testing.T) {
			w := httptest.NewRecorder()
			c.graph(w, httptest.NewRequest("GET", "/memory/graph"+target.query, nil))
			if w.Code != target.want {
				t.Fatalf("got %d, want %d", w.Code, target.want)
			}
			var got envelope.APIError
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatalf("invalid error envelope: %v", err)
			}
			if got.Error != target.wantKind || got.Code != "MEMORY_UNAVAILABLE" || got.Message == "" {
				t.Fatalf("error envelope = %+v, want kind %q and MEMORY_UNAVAILABLE", got, target.wantKind)
			}
		})
	}
}

func TestMemoryInvalidProviderResponseUsesBadGatewayEnvelope(t *testing.T) {
	t.Setenv("AO_MEMORY_TEST_HELPER", "invalid")
	root := t.TempDir()
	c := MemoryController{Projects: memoryProjects{path: root}, Sessions: memorySessions{project: "p", path: root}, Python: os.Args[0], command: func(ctx context.Context, _ string, _ ...string) *exec.Cmd {
		return memoryCommand(ctx, os.Args[0], "-test.run=^TestMemoryStoreHelper$")
	}}
	w := httptest.NewRecorder()
	c.graph(w, httptest.NewRequest("GET", "/memory/graph?projectId=p&scope=project", nil))
	var got envelope.APIError
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("invalid error envelope: %v", err)
	}
	if w.Code != 502 || got.Error != "bad_gateway" || got.Code != "MEMORY_UNAVAILABLE" {
		t.Fatalf("status=%d envelope=%+v, want 502/bad_gateway/MEMORY_UNAVAILABLE", w.Code, got)
	}
}

func TestMemoryResolvesRegisteredProjectAndSessionWorkspace(t *testing.T) {
	root, worktree := t.TempDir(), t.TempDir()
	c := MemoryController{Projects: memoryProjects{path: root}, Sessions: memorySessions{project: "p", path: worktree}}
	for _, tc := range []struct{ scope, session, want string }{{"project", "", root}, {"worktree", "s", worktree}, {"session", "s", worktree}} {
		got, err := c.resolveWorkspace(context.Background(), "p", tc.scope, tc.session)
		if err != nil || got != tc.want {
			t.Fatalf("%s: got %q, %v; want %q", tc.scope, got, err, tc.want)
		}
	}
	c.Sessions = memorySessions{project: "other", path: worktree}
	if _, err := c.resolveWorkspace(context.Background(), "p", "session", "s"); err == nil {
		t.Fatal("accepted session owned by another project")
	}
}

func TestMemoryHandlerUsesStoredSessionWorkspace(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		cmd := memoryCommand(ctx, "git", append([]string{"-C", root}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git: %v: %s", err, out)
		}
	}
	git("init", "-q")
	git("-c", "user.name=AO Test", "-c", "user.email=ao@example.invalid", "commit", "--allow-empty", "-qm", "fixture")
	worktree := filepath.Join(t.TempDir(), "worktree")
	git("worktree", "add", "-qb", "session-test", worktree)
	store := sqlitetest.MustOpen(t)
	now := time.Now().UTC()
	if err := store.UpsertProject(ctx, domain.ProjectRecord{ID: "p", Path: root, RegisteredAt: now}); err != nil {
		t.Fatal(err)
	}
	record, err := store.CreateSession(ctx, domain.SessionRecord{ProjectID: "p", Kind: domain.KindWorker, Activity: domain.Activity{State: domain.ActivityActive, LastActivityAt: now}, CreatedAt: now, UpdatedAt: now, Metadata: domain.SessionMetadata{WorkspacePath: worktree}})
	if err != nil {
		t.Fatal(err)
	}
	var gotWorkspace string
	c := MemoryController{Projects: projectsvc.New(store), Sessions: sessionsvc.New(nil, store), Python: os.Args[0], command: func(ctx context.Context, _ string, args ...string) *exec.Cmd {
		for i := range args {
			if args[i] == "--workspace" && i+1 < len(args) {
				gotWorkspace = args[i+1]
			}
		}
		cmd := memoryCommand(ctx, os.Args[0], "-test.run=^TestMemoryStoreHelper$")
		cmd.Env = append(os.Environ(), "AO_MEMORY_TEST_HELPER=1")
		return cmd
	}}
	t.Setenv("AO_MEMORY_TEST_HELPER", "1")
	w := httptest.NewRecorder()
	c.graph(w, httptest.NewRequest("GET", "/memory/graph?projectId=p&scope=session&sessionId="+string(record.ID)+"&workspace=untrusted", nil))
	if w.Code != 200 || gotWorkspace != worktree {
		t.Fatalf("status=%d workspace=%q, want %q", w.Code, gotWorkspace, worktree)
	}
}

func TestMemoryStoreHelper(t *testing.T) {
	switch os.Getenv("AO_MEMORY_TEST_HELPER") {
	case "invalid":
		fmt.Print(`{"schema_version":1,"visibility_token":""}`)
		os.Exit(0)
	case "1":
		fmt.Print(`{"schema_version":1,"visibility_token":"fixture","nodes":[],"edges":[],"errors":[]}`)
		os.Exit(0)
	default:
		return
	}
}
