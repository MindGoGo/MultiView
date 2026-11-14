package local.multiview.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder

/**
 * 背景播放（R154）：有聲音的原生播放器在播放時，用前景服務讓 App 在背景繼續執行，
 * 並在通知與鎖定畫面顯示正在播放的影片名稱，可以播放／暫停。
 * 播放器本身在 [AppModel] 裡，這個服務只負責「讓系統知道 App 正在播放」。
 */
class PlaybackService : Service() {
    private lateinit var session: MediaSession
    private val model: AppModel get() = (application as MultiViewApplication).model

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "背景播放", NotificationManager.IMPORTANCE_LOW).apply {
                description = "在背景播放聲音時顯示"
                setShowBadge(false)
            },
        )
        session = MediaSession(this, "MultiView").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = model.remotePlay()
                override fun onPause() = model.remotePause()
                override fun onStop() = model.remotePause()
            })
            isActive = true
        }
        refresh()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> model.remotePlay()
            ACTION_PAUSE -> model.remotePause()
        }
        refresh()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        session.isActive = false
        session.release()
        super.onDestroy()
    }

    /** 依目前的狀態更新通知與鎖定畫面。 */
    private fun refresh() {
        session.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).build())
        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE)
                .setState(
                    if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    PlaybackState.PLAYBACK_POSITION_UNKNOWN,
                    if (playing) 1f else 0f,
                )
                .build(),
        )
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val immutable = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), immutable)
        val toggle = PendingIntent.getService(
            this,
            1,
            Intent(this, PlaybackService::class.java).setAction(if (playing) ACTION_PAUSE else ACTION_PLAY),
            immutable,
        )
        val action = Notification.Action.Builder(
            Icon.createWithResource(this, if (playing) R.drawable.ic_stat_pause else R.drawable.ic_stat_play),
            if (playing) "暫停" else "播放",
            toggle,
        ).build()
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_play)
            .setContentTitle(title)
            .setContentText("MultiView")
            .setContentIntent(open)
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(action)
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0))
            .build()
    }

    companion object {
        private const val CHANNEL = "playback"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_PLAY = "local.multiview.android.PLAY"
        private const val ACTION_PAUSE = "local.multiview.android.PAUSE"

        private var instance: PlaybackService? = null
        private var title = "MultiView"
        private var playing = false

        /**
         * 更新背景播放的狀態。wanted：需不需要這個服務（有聲音的原生播放器在播放，或在背景被通知暫停、等著繼續）。
         * 服務已經在執行時直接更新；還沒執行時啟動它（只有 App 在前景時才允許啟動，失敗就算了）。
         */
        fun sync(context: Context, wanted: Boolean, title: String, playing: Boolean) {
            this.title = title
            this.playing = playing
            val running = instance
            when {
                !wanted -> running?.let {
                    it.stopForeground(Service.STOP_FOREGROUND_REMOVE)
                    it.stopSelf()
                }
                running != null -> running.refresh()
                else -> try {
                    context.startForegroundService(Intent(context, PlaybackService::class.java))
                } catch (_: Exception) {
                }
            }
        }
    }
}
