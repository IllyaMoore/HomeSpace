package io.github.illyamoore.homespace.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The SSE parser is the piece most exposed to the daemon changing under us, so
 * it is tested against the exact frames docs/api.md documents.
 */
class EventStreamTest {

    private val stream = EventStream(
        HomeSpaceClient(ServerRef("id", "n", "http://localhost:7333", "t")),
    )

    @Test
    fun `hello marks the stream connected`() {
        assertEquals(ServerEvent.Connected, stream.parse("hello", """{"name":"NAS"}"""))
    }

    @Test
    fun `session status is parsed`() {
        val event = stream.parse("session.status", """{"sessionId":"s1","status":"working"}""")
        assertEquals(ServerEvent.SessionStatus("s1", "working"), event)
    }

    @Test
    fun `session created carries a null agent as null, not the string null`() {
        val event = stream.parse("session.created", """{"sessionId":"s1","agentId":null}""")
        assertEquals(ServerEvent.SessionCreated("s1", null), event)
    }

    @Test
    fun `session created keeps a real agent id`() {
        val event = stream.parse("session.created", """{"sessionId":"s1","agentId":"agent_1"}""")
        assertEquals(ServerEvent.SessionCreated("s1", "agent_1"), event)
    }

    @Test
    fun `session closed carries the exit code`() {
        val event = stream.parse("session.closed", """{"sessionId":"s1","code":143}""")
        assertEquals(ServerEvent.SessionClosed("s1", 143), event)
    }

    @Test
    fun `a transcript entry is decoded`() {
        val event = stream.parse(
            "session.message",
            """{"sessionId":"s1","entry":{"seq":4,"at":"2026-01-01T00:00:00Z","kind":"assistant","text":"hi"}}""",
        )
        val message = event as ServerEvent.SessionMessage
        assertEquals("s1", message.sessionId)
        assertEquals(4L, message.entry.seq)
        assertEquals("assistant", message.entry.kind)
        assertEquals("hi", message.entry.text)
    }

    @Test
    fun `a tool_use entry keeps its input for the summary line`() {
        val event = stream.parse(
            "session.message",
            """{"sessionId":"s1","entry":{"seq":3,"kind":"tool_use","name":"Read",
               "input":{"file_path":"/v1/code/a.txt"}}}""",
        )
        val entry = (event as ServerEvent.SessionMessage).entry
        assertEquals("Read", entry.name)
        assertTrue(entry.input.toString().contains("a.txt"))
    }

    @Test
    fun `frames without a seq are the CLI's partial tokens and are dropped`() {
        val event = stream.parse(
            "session.message",
            """{"sessionId":"s1","entry":{"type":"stream_event","event":{}}}""",
        )
        assertNull(event)
    }

    @Test
    fun `agent events are collapsed to one change signal`() {
        assertEquals(ServerEvent.AgentChanged("a1"), stream.parse("agent.created", """{"agentId":"a1"}"""))
        assertEquals(ServerEvent.AgentChanged("a1"), stream.parse("agent.updated", """{"agentId":"a1"}"""))
        assertEquals(ServerEvent.AgentChanged("a1"), stream.parse("agent.deleted", """{"agentId":"a1"}"""))
    }

    @Test
    fun `an unknown event type is ignored rather than crashing the stream`() {
        assertNull(stream.parse("something.new", """{"a":1}"""))
    }

    @Test
    fun `malformed json is ignored`() {
        assertNull(stream.parse("session.status", "not json at all"))
        assertNull(stream.parse("session.status", ""))
    }

    @Test
    fun `an event missing its session id is ignored`() {
        assertNull(stream.parse("session.status", """{"status":"working"}"""))
        assertNull(stream.parse("session.message", """{"entry":{"seq":1}}"""))
    }
}
