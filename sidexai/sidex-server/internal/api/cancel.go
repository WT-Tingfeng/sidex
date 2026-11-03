package api

import (
	"context"
	"encoding/json"
	"sync"
)

// WebSocket cancel protocol (client -> server):
//
//	{"type":"cancel","session_id":"<session id>"}
//
// session_id may be omitted when the frame arrives on the connection that owns
// the running session. The server immediately acknowledges with
//
//	{"type":"canceled","session_id":"<id>","active":<bool>}
//
// and the aborted turn then emits its usual {"type":"done","done":true}. The
// cancellation also aborts the in-flight provider HTTP request, so the Stop
// button takes effect while the model is still streaming.
const cancelMessageType = "cancel"

// cancelFrame asks the server to stop the in-flight turn for a session.
type cancelFrame struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
}

// tryParseCancel recognises a cancel frame. It is checked before the chat
// request decoder so a cancel can never be mistaken for a turn with an empty
// message.
func tryParseCancel(raw []byte) *cancelFrame {
	var frame cancelFrame
	if err := json.Unmarshal(raw, &frame); err != nil {
		return nil
	}
	if frame.Type != cancelMessageType {
		return nil
	}
	return &frame
}

// turnCancels maps a session id to the cancel function of its in-flight agent
// turn, so the WebSocket read loop can stop generation when the client sends a
// cancel frame (the Stop button, or closing/backgrounding the chat).
//
// Only one turn runs per session at a time, so a plain map is enough. Entries
// are compared by pointer identity so a finishing turn can only remove its own
// registration, never a newer turn's.
type turnCancels struct {
	mu      sync.Mutex
	entries map[string]*turnCancelEntry
}

type turnCancelEntry struct {
	cancel context.CancelFunc
}

func newTurnCancels() *turnCancels {
	return &turnCancels{entries: make(map[string]*turnCancelEntry)}
}

// register records the cancel function for a session's in-flight turn and
// returns the entry to pass to unregister. Nil receivers are tolerated so tests
// that build a bare Handler keep working.
func (tc *turnCancels) register(sessionID string, cancel context.CancelFunc) *turnCancelEntry {
	if tc == nil || sessionID == "" || cancel == nil {
		return nil
	}
	entry := &turnCancelEntry{cancel: cancel}
	tc.mu.Lock()
	defer tc.mu.Unlock()
	if tc.entries == nil {
		tc.entries = make(map[string]*turnCancelEntry)
	}
	tc.entries[sessionID] = entry
	return entry
}

// unregister drops a previously registered entry, but only while it is still
// the live one for that session.
func (tc *turnCancels) unregister(sessionID string, entry *turnCancelEntry) {
	if tc == nil || sessionID == "" || entry == nil {
		return
	}
	tc.mu.Lock()
	defer tc.mu.Unlock()
	if tc.entries[sessionID] == entry {
		delete(tc.entries, sessionID)
	}
}

// cancel aborts the in-flight turn for a session and reports whether one was
// running.
func (tc *turnCancels) cancel(sessionID string) bool {
	if tc == nil || sessionID == "" {
		return false
	}
	tc.mu.Lock()
	entry := tc.entries[sessionID]
	delete(tc.entries, sessionID)
	tc.mu.Unlock()
	if entry == nil {
		return false
	}
	entry.cancel()
	return true
}

// beginTurn returns the context the agent loop watches for cancellation plus a
// cleanup function to call when the turn finishes.
func (h *Handler) beginTurn(sessionID string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(context.Background())
	entry := h.cancels.register(sessionID, cancel)
	return ctx, func() {
		h.cancels.unregister(sessionID, entry)
		cancel()
	}
}

// cancelTurn stops the in-flight agent turn for a session, if any.
func (h *Handler) cancelTurn(sessionID string) bool {
	return h.cancels.cancel(sessionID)
}
