package api

import (
	"testing"
	"time"
)

func TestTurnCancelsCancelStopsTurn(t *testing.T) {
	h := &Handler{cancels: newTurnCancels()}
	ctx, endTurn := h.beginTurn("s1")
	defer endTurn()

	if !h.cancelTurn("s1") {
		t.Fatal("expected an active turn to cancel")
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("turn context was not cancelled")
	}
	if h.cancelTurn("s1") {
		t.Error("a second cancel must report no active turn")
	}
}

func TestTurnCancelsBareHandlerIsSafe(t *testing.T) {
	// Tests and partial initialisations build Handlers without a registry; a
	// cancel must not panic there.
	h := &Handler{}
	ctx, endTurn := h.beginTurn("s1")
	defer endTurn()

	if h.cancelTurn("s1") {
		t.Error("no registry means nothing to cancel")
	}
	select {
	case <-ctx.Done():
		t.Error("context must not be cancelled without a registered turn")
	default:
	}
}

func TestTurnCancelsUnregisterKeepsNewerTurn(t *testing.T) {
	h := &Handler{cancels: newTurnCancels()}

	_, endOld := h.beginTurn("s1")
	ctxNew, endNew := h.beginTurn("s1")
	defer endNew()

	endOld() // the older turn finishing must not remove the newer registration
	if !h.cancelTurn("s1") {
		t.Fatal("newer turn registration was lost")
	}
	select {
	case <-ctxNew.Done():
	default:
		t.Fatal("newer turn context was not cancelled")
	}
}

func TestTryParseCancel(t *testing.T) {
	if frame := tryParseCancel([]byte(`{"type":"cancel","session_id":"s1"}`)); frame == nil || frame.SessionID != "s1" {
		t.Fatalf("valid cancel frame not parsed: %#v", frame)
	}
	if frame := tryParseCancel([]byte(`{"type":"cancel"}`)); frame == nil || frame.SessionID != "" {
		t.Fatalf("session_id must be optional: %#v", frame)
	}
	if tryParseCancel([]byte(`{"type":"message"}`)) != nil {
		t.Error("chat frames must not be treated as cancels")
	}
	if tryParseCancel([]byte(`not json`)) != nil {
		t.Error("malformed frames must be ignored")
	}
}

// End-to-end: a cancel frame sent over a real websocket is acknowledged even
// when no turn is running, so a client that stops an already-finished turn is
// never left waiting.
func TestWebSocketCancelFrameIsAcknowledged(t *testing.T) {
	srv := bootTestServer(t)
	c := dialWS(t, srv)

	if err := c.WriteJSON(map[string]string{"type": "cancel", "session_id": "missing-session"}); err != nil {
		t.Fatalf("write: %v", err)
	}

	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	for i := 0; i < 3; i++ {
		var frame map[string]interface{}
		if err := c.ReadJSON(&frame); err != nil {
			t.Fatalf("read: %v", err)
		}
		if frame["type"] != "canceled" {
			continue
		}
		if frame["session_id"] != "missing-session" {
			t.Errorf("session_id = %v, want missing-session", frame["session_id"])
		}
		if frame["active"] != false {
			t.Errorf("active = %v, want false for an idle session", frame["active"])
		}
		return
	}
	t.Fatal("no canceled frame received")
}
