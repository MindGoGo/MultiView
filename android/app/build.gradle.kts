// MultiView Android 版的 App（規格 android-app R145）
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.compose")
    id("com.chaquo.python")
}

// 版本號在 gradle.properties（multiview.versionName）；versionCode 由版本號算出來，
// 0.0.1 → 1、0.1.0 → 1000、1.2.3 → 1002003，版本號變大 versionCode 就變大（覆蓋安裝的條件）
val appVersionName = providers.gradleProperty("multiview.versionName").get()
val appVersionCode = appVersionName.split(".").let { parts ->
    require(parts.size == 3 && parts.all { p -> p.isNotEmpty() && p.all(Char::isDigit) }) {
        "multiview.versionName 必須是 <主>.<次>.<修> 的格式：$appVersionName"
    }
    val (major, minor, patch) = parts.map(String::toInt)
    require(minor < 1000 && patch < 1000) { "次版本號與修正號必須小於 1000：$appVersionName" }
    major * 1_000_000 + minor * 1_000 + patch
}

// 發佈用的簽章（R145）：GitHub Actions 從 Secrets 還原金鑰檔，透過環境變數傳進來。
// 沒有這些環境變數時（開發環境、分支的測試）release 版不簽章，只能裝 debug 版。
val releaseKeystore = System.getenv("MULTIVIEW_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }

android {
    namespace = "local.multiview.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "local.multiview.android"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName

        // Chaquopy 的 Python 是原生程式，要指定 CPU 架構。測試裝置（POCO F6 Pro）與大部分手機是 arm64
        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("MULTIVIEW_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MULTIVIEW_KEY_ALIAS")
                keyPassword = System.getenv("MULTIVIEW_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // 先不縮減程式碼：之後要包 Python（Chaquopy）與反射呼叫，縮減容易出問題
            isMinifyEnabled = false
            if (releaseKeystore != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            // debug 版可以和發佈版同時安裝在同一支手機
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

// 內嵌 Python 與 yt-dlp（R148）。版本和 iOS 版相同（ios/scripts/fetch-python.sh）
chaquopy {
    defaultConfig {
        version = "3.13"
        pip {
            install("yt-dlp==2026.10.26")
            install("yt-dlp-ejs==0.8.0")
            install("certifi==2026.10.23")
        }
        // yt-dlp-ejs 從套件資料夾讀解題程式（.js），解開成一般檔案比較保險
        extractPackages("yt_dlp_ejs")
    }
    sourceSets {
        getByName("main") {
            // 直接重用 iOS 版的 mv_bridge.py、mv_jsc.py（R148）；Android 版自己的在 src/main/python
            srcDir("../../ios/MultiView/YtDlp")
        }
    }
}

dependencies {
    implementation(project(":core"))

    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")

    // 原生播放器（R146）
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-exoplayer-hls:1.8.0")
    implementation("androidx.media3:media3-ui:1.8.0")

    // yt-dlp 的 JS 解題程式用手機 WebView 的 V8 執行，在獨立的沙箱裡（R148）
    implementation("androidx.javascriptengine:javascriptengine:1.0.0")
}
