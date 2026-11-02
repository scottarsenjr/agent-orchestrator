//go:build windows

package controllers

import (
	"context"
	"testing"

	"golang.org/x/sys/windows"
)

func TestMemoryCommandHidesConsoleAndPreservesArguments(t *testing.T) {
	cmd := memoryCommand(context.Background(), `C:\test path\python.exe`, "-X", "utf8", "-I", "-m", "jarvis_core.cli", "memory", "graph", "--workspace", `C:\test path\workspace`, "--json")
	if cmd.SysProcAttr == nil || cmd.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 || !cmd.SysProcAttr.HideWindow {
		t.Fatal("memory command must hide its Windows console")
	}
	if len(cmd.Args) != 11 || cmd.Args[9] != `C:\test path\workspace` || cmd.Args[10] != "--json" {
		t.Fatalf("argument array changed: %q", cmd.Args)
	}
}
