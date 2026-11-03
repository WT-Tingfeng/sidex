package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/sidex-ai/sidex-server/internal/ai"
	"github.com/sidex-ai/sidex-server/internal/cost"
)

func TestDeclaredModelInfosUsesConservativeDefaults(t *testing.T) {
	infos := declaredModelInfos(ai.ProviderConfig{
		Provider: "myapi",
		Models:   []string{"llama3.1", "vendor/known", "llama3.1"},
	})
	if len(infos) != 2 {
		t.Fatalf("infos = %#v, want two deduplicated entries", infos)
	}
	first := infos[0]
	if first.ID != "myapi/llama3.1" || first.Provider != "myapi" || first.Name != "llama3.1" {
		t.Fatalf("first = %#v", first)
	}
	if first.ContextWindow != customModelContextWindow || first.MaxOutput != customModelMaxOutput {
		t.Errorf("unknown model metadata = %d/%d, want %d/%d",
			first.ContextWindow, first.MaxOutput, customModelContextWindow, customModelMaxOutput)
	}
	if !first.SupportsTools || !first.Default {
		t.Errorf("declared models must be selectable by default: %#v", first)
	}
}

func TestDeclaredModelInfosKeepsCatalogMetadata(t *testing.T) {
	infos := declaredModelInfos(ai.ProviderConfig{
		Provider: "myapi",
		Models:   []string{"anthropic/claude-sonnet-4.6"},
	})
	if len(infos) != 1 {
		t.Fatalf("infos = %#v", infos)
	}
	got := infos[0]
	if got.ContextWindow != 200_000 || got.MaxOutput != 64_000 {
		t.Errorf("catalog model metadata = %d/%d, want 200000/64000", got.ContextWindow, got.MaxOutput)
	}
}

// reachableModels must advertise the models declared in
// SIDEX_PROVIDER_<ID>_MODELS when the endpoint itself returns no catalog.
func TestReachableModelsFallsBackToDeclaredModels(t *testing.T) {
	// Isolate from any provider credentials the host environment carries.
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "SIDEX_PROVIDER_") {
			key, _, _ := strings.Cut(kv, "=")
			t.Setenv(key, "")
		}
	}

	models := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer models.Close()

	t.Setenv("SIDEX_PROVIDER_LOCALBOX_BASE_URL", models.URL+"/v1")
	t.Setenv("SIDEX_PROVIDER_LOCALBOX_AUTH_STYLE", "none")
	t.Setenv("SIDEX_PROVIDER_LOCALBOX_MODELS", `["tiny","large"]`)

	var found []cost.ModelInfo
	for _, info := range reachableModels() {
		if info.Provider == "localbox" {
			found = append(found, info)
		}
	}
	if len(found) != 2 {
		t.Fatalf("declared models missing from /v1/models: %#v", found)
	}
	if found[0].ID != "localbox/tiny" || found[0].ContextWindow != customModelContextWindow {
		t.Errorf("first = %#v", found[0])
	}
	if found[1].ID != "localbox/large" || found[1].MaxOutput != customModelMaxOutput {
		t.Errorf("second = %#v", found[1])
	}
}
