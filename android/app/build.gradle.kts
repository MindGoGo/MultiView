// MultiView Android 版的 App（規格 android-app R145）
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.compose")
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

dependencies {
    implementation(project(":core"))

    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
}
