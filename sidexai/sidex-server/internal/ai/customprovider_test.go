package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Custom providers are described entirely through SIDEX_PROVIDER_<ID>_* env
// vars; these tests pin how each field is decoded and how the values reach the
// wire (auth header, protocol, model name).
func TestLocalProviderCustomEnvParsed(t *testing.T) {
	t.Setenv("SIDEX_PROVIDER_MYAPI_KEY", "tok")
	t.Setenv("SIDEX_PROVIDER_MYAPI_BASE_URL", "https://api.example.com/v1")
	t.Setenv("SIDEX_PROVIDER_MYAPI_AUTH_STYLE", "x-api-key")
	t.Setenv("SIDEX_PROVIDER_MYAPI_PROTOCOL", "anthropic")
	t.Setenv("SIDEX_PROVIDER_MYAPI_MODELS", `["claude-x","claude-y","claude-x"]`)

	cfg, ok := LocalProviderConfig("myapi")
	if !ok {
		t.Fatal("custom provider must resolve from SIDEX_PROVIDER_* env vars")
	}
	if cfg.AuthStyle != AuthStyleXAPIKey {
		t.Errorf("auth style = %q, want %q", cfg.AuthStyle, AuthStyleXAPIKey)
	}
	if cfg.Protocol != ProtocolAnthropic {
		t.Errorf("protocol = %q, want %q", cfg.Protocol, ProtocolAnthropic)
	}
	if len(cfg.Models) != 2 || cfg.Models[0] != "claude-x" || cfg.Models[1] != "claude-y" {
		t.Errorf("models = %#v, want deduplicated [claude-x claude-y]", cfg.Models)
	}
	if cfg.BaseURL != "https://api.example.com/v1" {
		t.Errorf("base URL = %q", cfg.BaseURL)
	}
}

func TestLocalProviderKeylessWithAuthStyleNone(t *testing.T) {
	t.Setenv("SIDEX_PROVIDER_KEYLESS_BASE_URL", "https://api.example.com/v1")
	t.Setenv("SIDEX_PROVIDER_KEYLESS_AUTH_STYLE", "none")

	cfg, ok := LocalProviderConfig("keyless")
	if !ok {
		t.Fatal("AUTH_STYLE=none must allow a remote provider without a key")
	}
	if cfg.APIKey != "" || cfg.AuthStyle != AuthStyleNone {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestLocalProviderHyphenatedIDEnv(t *testing.T) {
	t.Setenv("SIDEX_PROVIDER_MY_API_KEY", "tok")
	t.Setenv("SIDEX_PROVIDER_MY_API_BASE_URL", "https://api.example.com/v1")

	cfg, ok := LocalProviderConfig("my-api")
	if !ok || cfg.APIKey != "tok" {
		t.Fatalf("hyphenated id must map to a sanitised env var: ok=%v cfg=%+v", ok, cfg)
	}
}

// A keyless endpoint may only replace the OpenRouter client when it is loopback
// or explicitly declares AUTH_STYLE=none; anything else must keep the current
// client instead of rerouting requests to an endpoint that will answer 401.
func TestWithProviderConfigKeylessRules(t *testing.T) {
	newBase := func() *Client { return (&Client{}).WithModel("myapi/test-model") }

	remote := ProviderConfig{Provider: "myapi", BaseURL: "https://api.example.com/v1", Enabled: true}
	if c := newBase().WithProviderConfig(remote); c.provider != "" {
		t.Errorf("keyless remote without AUTH_STYLE=none replaced the client: provider %q", c.provider)
	}

	remote.AuthStyle = AuthStyleNone
	if c := newBase().WithProviderConfig(remote); c.provider != "myapi" {
		t.Errorf("AUTH_STYLE=none must allow a keyless remote provider, got provider %q", c.provider)
	}

	loopback := ProviderConfig{Provider: "ollama", BaseURL: "http://127.0.0.1:11434/v1", Enabled: true}
	if c := newBase().WithProviderConfig(loopback); c.provider != "ollama" {
		t.Errorf("a loopback provider must work without a key, got provider %q", c.provider)
	}
}

func TestCustomProviderAuthHeaders(t *testing.T) {
	for _, tc := range []struct {
		name  string
		style string
	}{
		{"bearer", AuthStyleBearer},
		{"x-api-key", AuthStyleXAPIKey},
		{"api-key", AuthStyleAPIKey},
		{"none", AuthStyleNone},
	} {
		t.Run(tc.name, func(t *testing.T) {
			headers := make(chan http.Header, 1)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				headers <- r.Header.Clone()
				w.Header().Set("Content-Type", "text/event-stream")
				// No space after "data:" — the tolerance this path must keep.
				fmt.Fprint(w, "data:{\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n")
				fmt.Fprint(w, "data:[DONE]\n")
			}))
			defer srv.Close()

			c := (&Client{httpClient: srv.Client()}).WithModel("myapi/test-model").
				WithProviderConfig(ProviderConfig{
					Provider:  "myapi",
					APIKey:    "tok",
					BaseURL:   srv.URL,
					Protocol:  ProtocolOpenAI,
					AuthStyle: tc.style,
					Enabled:   true,
				})

			var text strings.Builder
			err := c.StreamChatWithOptions(
				[]Message{{Role: RoleUser, Content: "hi"}}, nil, "", nil,
				func(ch StreamChunk) {
					if ch.Type == "text" {
						text.WriteString(ch.Content)
					}
				})
			if err != nil {
				t.Fatalf("stream: %v", err)
			}
			if text.String() != "ok" {
				t.Errorf("text = %q, want ok", text.String())
			}

			got := <-headers
			switch tc.style {
			case AuthStyleNone:
				for _, header := range []string{"Authorization", "x-api-key", "api-key"} {
					if v := got.Get(header); v != "" {
						t.Errorf("%s = %q, want empty for a keyless endpoint", header, v)
					}
				}
			case AuthStyleXAPIKey:
				if v := got.Get("x-api-key"); v != "tok" {
					t.Errorf("x-api-key = %q, want tok", v)
				}
			case AuthStyleAPIKey:
				if v := got.Get("api-key"); v != "tok" {
					t.Errorf("api-key = %q, want tok", v)
				}
			default:
				if v := got.Get("Authorization"); v != "Bearer tok" {
					t.Errorf("Authorization = %q, want Bearer tok", v)
				}
			}
		})
	}
}

// PROTOCOL=anthropic must send the Messages API shape and the custom auth
// header, not OpenAI chat completions with x-api-key.
func TestCustomAnthropicProtocolUsesMessagesAPI(t *testing.T) {
	type requestInfo struct {
		path    string
		auth    string
		apiKey  string
		version string
		model   string
	}
	infos := make(chan requestInfo, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		model, _ := body["model"].(string)
		infos <- requestInfo{
			path:    r.URL.Path,
			auth:    r.Header.Get("Authorization"),
			apiKey:  r.Header.Get("x-api-key"),
			version: r.Header.Get("anthropic-version"),
			model:   model,
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n")
		fmt.Fprint(w, "data: {\"type\":\"message_stop\"}\n")
	}))
	defer srv.Close()

	c := (&Client{httpClient: srv.Client()}).WithModel("myapi/claude-custom").
		WithProviderConfig(ProviderConfig{
			Provider:  "myapi",
			APIKey:    "tok",
			BaseURL:   srv.URL,
			Protocol:  ProtocolAnthropic,
			AuthStyle: AuthStyleBearer,
			Enabled:   true,
		})

	var text strings.Builder
	err := c.StreamChatWithOptions(
		[]Message{{Role: RoleUser, Content: "hi"}}, nil, "be brief", nil,
		func(ch StreamChunk) {
			if ch.Type == "text" {
				text.WriteString(ch.Content)
			}
		})
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	if text.String() != "hi" {
		t.Errorf("text = %q, want hi", text.String())
	}

	got := <-infos
	if got.path != "/messages" {
		t.Errorf("path = %q, want /messages", got.path)
	}
	if got.auth != "Bearer tok" {
		t.Errorf("Authorization = %q, want Bearer tok", got.auth)
	}
	if got.apiKey != "" {
		t.Errorf("x-api-key = %q, want empty for AUTH_STYLE=bearer", got.apiKey)
	}
	if got.version != anthropicVersion {
		t.Errorf("anthropic-version = %q", got.version)
	}
	if got.model != "claude-custom" {
		t.Errorf("model = %q, want the configured id without the provider prefix", got.model)
	}
}

func TestParseSSEToleratesDataWithoutSpace(t *testing.T) {
	c := &Client{}
	var text strings.Builder
	var done bool
	err := c.parseSSEStream(
		strings.NewReader("data:{\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\ndata:[DONE]\n"),
		func(ch StreamChunk) {
			if ch.Type == "text" {
				text.WriteString(ch.Content)
			}
			if ch.Type == "done" && ch.Done {
				done = true
			}
		})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if text.String() != "a" {
		t.Errorf("text = %q, want a", text.String())
	}
	if !done {
		t.Error("expected a done chunk")
	}
}

func TestParseSSESurfacesErrorObject(t *testing.T) {
	c := &Client{}
	err := c.parseSSEStream(
		strings.NewReader("data: {\"error\":{\"type\":\"server_error\",\"message\":\"upstream overloaded\"}}\n"),
		func(StreamChunk) {})
	if err == nil || !strings.Contains(err.Error(), "upstream overloaded") {
		t.Fatalf("expected the in-band error to surface, got %v", err)
	}
}

func TestNonStreamCompletionFallback(t *testing.T) {
	answered := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"content":"hello","tool_calls":[{"id":"t1","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"a.txt\"}"}}]}}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}`)
		answered <- struct{}{}
	}))
	defer srv.Close()

	c := (&Client{httpClient: srv.Client()}).WithModel("myapi/test-model").
		WithProviderConfig(ProviderConfig{Provider: "myapi", APIKey: "tok", BaseURL: srv.URL, Enabled: true})

	var text strings.Builder
	var calls []ToolCall
	var used *Usage
	var done bool
	err := c.StreamChatWithOptions(
		[]Message{{Role: RoleUser, Content: "hi"}}, nil, "", nil,
		func(ch StreamChunk) {
			switch ch.Type {
			case "text":
				text.WriteString(ch.Content)
			case "tool_call":
				calls = append(calls, ch.ToolCalls...)
			case "usage":
				used = ch.TokensUsed
			case "done":
				done = ch.Done
			}
		})
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	<-answered

	if text.String() != "hello" {
		t.Errorf("text = %q, want hello", text.String())
	}
	if len(calls) != 1 || calls[0].ID != "t1" || calls[0].Function.Name != "read_file" {
		t.Fatalf("tool calls = %#v", calls)
	}
	if used == nil || used.TotalTokens != 7 {
		t.Fatalf("usage = %#v", used)
	}
	if !done {
		t.Error("expected a done chunk")
	}
}

// Cancelling the request context (the WebSocket cancel frame) must abort a
// stream that is still open instead of draining the whole response.
func TestStreamAbortsOnContextCancel(t *testing.T) {
	reached := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		reached <- struct{}{}
		<-r.Context().Done()
	}))
	defer srv.Close()

	c := (&Client{httpClient: srv.Client()}).WithModel("myapi/test-model").
		WithProviderConfig(ProviderConfig{Provider: "myapi", APIKey: "tok", BaseURL: srv.URL, Enabled: true})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- c.StreamChatWithOptions(
			[]Message{{Role: RoleUser, Content: "hi"}}, nil, "",
			&StreamOptions{Context: ctx},
			func(StreamChunk) {})
	}()

	<-reached
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected the stream to fail after cancellation")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("stream did not abort within 5s of context cancellation")
	}
}

func TestApplyListHeadersCustomAuthStyle(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://api.example.com/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	applyListHeaders(req, ProviderConfig{Provider: "myapi", APIKey: "tok", AuthStyle: AuthStyleAPIKey})
	if got := req.Header.Get("api-key"); got != "tok" {
		t.Errorf("api-key = %q, want tok", got)
	}
	if got := req.Header.Get("Authorization"); got != "" {
		t.Errorf("Authorization = %q, want empty", got)
	}

	req, err = http.NewRequest(http.MethodGet, "https://api.example.com/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	applyListHeaders(req, ProviderConfig{Provider: "myapi", AuthStyle: AuthStyleNone, Protocol: ProtocolAnthropic})
	if got := req.Header.Get("anthropic-version"); got != anthropicVersion {
		t.Errorf("anthropic-version = %q, want %q", got, anthropicVersion)
	}
	for _, header := range []string{"Authorization", "x-api-key", "api-key"} {
		if got := req.Header.Get(header); got != "" {
			t.Errorf("%s = %q, want empty", header, got)
		}
	}
}

func TestParseDeclaredModels(t *testing.T) {
	cases := []struct {
		raw  string
		want []string
	}{
		{`["a","b"]`, []string{"a", "b"}},
		{`["a","a","b"]`, []string{"a", "b"}},
		{`a, b`, []string{"a", "b"}},
		{`[]`, nil},
		{``, nil},
	}
	for _, tc := range cases {
		got := parseDeclaredModels(tc.raw)
		if len(got) != len(tc.want) {
			t.Fatalf("parseDeclaredModels(%q) = %#v, want %#v", tc.raw, got, tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("parseDeclaredModels(%q) = %#v, want %#v", tc.raw, got, tc.want)
			}
		}
	}
}

func TestUsesAnthropicProtocolMatrix(t *testing.T) {
	for _, tc := range []struct {
		provider string
		protocol string
		want     bool
	}{
		{"", "", false},
		{"anthropic", "", true},
		{"openai", "", false},
		{"myapi", ProtocolOpenAI, false},
		{"myapi", ProtocolAnthropic, true},
		{"anthropic", ProtocolOpenAI, false},
	} {
		c := &Client{provider: tc.provider, protocol: tc.protocol}
		if got := c.usesAnthropicProtocol(); got != tc.want {
			t.Errorf("provider=%q protocol=%q: got %v, want %v", tc.provider, tc.protocol, got, tc.want)
		}
	}
}
