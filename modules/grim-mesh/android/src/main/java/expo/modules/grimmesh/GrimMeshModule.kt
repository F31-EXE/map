package expo.modules.grimmesh

import android.content.Context
import android.util.Log
import java.io.File
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Phone-to-phone link for GrimMap without internet, on Google Nearby Connections.
 * Every phone advertises and discovers at once (P2P_CLUSTER, a mesh of many-to-many
 * links); JS decides whom to connect to and what to send. Payloads are UTF-8 JSON
 * strings, each under Nearby's 32 KB byte-payload limit (JS keeps them small).
 */
class GrimMeshModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client: ConnectionsClient by lazy { Nearby.getConnectionsClient(context) }

  private var running = false
  private var myName = ""
  /** Only endpoints whose name starts with this are accepted (same squad). */
  private var acceptPrefix = ""
  // Touched from Nearby callbacks (main thread) and from JS calls (module queue).
  private val connected: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()

  private fun emitPeer(id: String, name: String?, state: String) {
    sendEvent("onPeer", mapOf("id" to id, "name" to name, "state" to state))
  }

  private fun emitError(where: String, e: Exception) {
    sendEvent("onError", mapOf("where" to where, "message" to (e.message ?: e.toString())))
  }

  private val payloadCallback = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      if (payload.type != Payload.Type.BYTES) return
      val bytes = payload.asBytes() ?: return
      sendEvent("onMessage", mapOf("from" to endpointId, "data" to String(bytes, Charsets.UTF_8)))
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
  }

  private val lifecycle = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
      if (!info.endpointName.startsWith(acceptPrefix)) {
        client.rejectConnection(endpointId)
        return
      }
      client.acceptConnection(endpointId, payloadCallback)
        .addOnFailureListener { emitError("accept", it) }
    }

    override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
      if (resolution.status.isSuccess) {
        connected.add(endpointId)
        emitPeer(endpointId, null, "connected")
      } else {
        emitPeer(endpointId, null, "failed")
      }
    }

    override fun onDisconnected(endpointId: String) {
      connected.remove(endpointId)
      emitPeer(endpointId, null, "disconnected")
    }
  }

  private val discovery = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      emitPeer(endpointId, info.endpointName, "found")
    }

    override fun onEndpointLost(endpointId: String) {
      emitPeer(endpointId, null, "lost")
    }
  }

  private fun stopAll() {
    if (!running) return
    running = false
    client.stopAdvertising()
    client.stopDiscovery()
    client.stopAllEndpoints()
    connected.clear()
  }

  override fun definition() = ModuleDefinition {
    Name("GrimMesh")

    Events("onPeer", "onMessage", "onError")

    /** Starts advertising and discovering under `serviceId` as `name`. */
    AsyncFunction("start") { serviceId: String, name: String, prefix: String ->
      stopAll()
      running = true
      myName = name
      acceptPrefix = prefix
      val strategy = Strategy.P2P_CLUSTER
      client.startAdvertising(name, serviceId, lifecycle, AdvertisingOptions.Builder().setStrategy(strategy).build())
        .addOnFailureListener { emitError("advertise", it) }
      client.startDiscovery(serviceId, discovery, DiscoveryOptions.Builder().setStrategy(strategy).build())
        .addOnFailureListener { emitError("discover", it) }
      Unit
    }

    AsyncFunction<Unit>("stop") {
      stopAll()
    }

    /** Asks a discovered endpoint to connect; both sides accept automatically. */
    AsyncFunction("connect") { endpointId: String ->
      if (!running) return@AsyncFunction
      client.requestConnection(myName, endpointId, lifecycle)
        .addOnFailureListener { emitError("connect", it) }
      Unit
    }

    /** Sends to the given endpoints, or to every connected one when `to` is empty. */
    AsyncFunction("send") { to: List<String>, data: String ->
      val targets = if (to.isEmpty()) connected.toList() else to.filter { connected.contains(it) }
      if (targets.isEmpty()) return@AsyncFunction
      client.sendPayload(targets, Payload.fromBytes(data.toByteArray(Charsets.UTF_8)))
        .addOnFailureListener { emitError("send", it) }
      Unit
    }

    Function("connectedPeers") {
      connected.toList()
    }

    OnDestroy {
      stopAll()
    }

    // Native crashes (ours or any library's) are written to a file before the app dies,
    // so the next launch can show what happened. JS: takeNativeCrash().
    OnCreate {
      val ctx = appContext.reactContext?.applicationContext ?: return@OnCreate
      val current = Thread.getDefaultUncaughtExceptionHandler()
      if (current !is CrashRecorder) {
        Thread.setDefaultUncaughtExceptionHandler(CrashRecorder(File(ctx.filesDir, CRASH_FILE), current))
      }
    }

    /** The last recorded native crash, once (the file is removed). */
    Function("takeNativeCrash") {
      val ctx = appContext.reactContext?.applicationContext ?: return@Function null
      val file = File(ctx.filesDir, CRASH_FILE)
      if (!file.exists()) return@Function null
      val text = file.readText()
      file.delete()
      text
    }
  }

  companion object {
    private const val CRASH_FILE = "grimmap-native-crash.txt"
  }
}

private class CrashRecorder(
  private val file: File,
  private val previous: Thread.UncaughtExceptionHandler?
) : Thread.UncaughtExceptionHandler {
  override fun uncaughtException(thread: Thread, error: Throwable) {
    try {
      file.writeText("${java.util.Date()} [${thread.name}]\n" + Log.getStackTraceString(error).take(8000))
    } catch (_: Throwable) {
      // Nothing more we can do while crashing.
    }
    previous?.uncaughtException(thread, error)
  }
}
