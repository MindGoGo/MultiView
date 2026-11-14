// 外掛的版本統一在根專案宣告，子專案只套用（Kotlin 外掛和 Android Gradle Plugin 要在同一個 classloader）。
// Android Gradle Plugin 只在有 Android SDK、加入 :app 時才放進 classpath（見 settings.gradle.kts），
// 這樣沒有 Android SDK（也連不到 Google 的 Maven）的環境還是能建置、測試 :core。
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        if (findProject(":app") != null) {
            classpath("com.android.tools.build:gradle:8.13.0")
            // 內嵌 Python（R148）
            classpath("com.chaquo.python:gradle:17.1.0")
        }
    }
}

plugins {
    kotlin("jvm") version "2.2.20" apply false
    kotlin("android") version "2.2.20" apply false
    kotlin("plugin.compose") version "2.2.20" apply false
}
