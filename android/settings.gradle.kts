// MultiView Android 版（規格 android-app R145）
pluginManagement {
    repositories {
        google {
            // 只向 Google 的 Maven 要 Android 相關的套件，其他的走 Maven Central
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        // Maven Central 的 Google 鏡像：Maven Central 會限流（HTTP 429，2026-11-15 在 Actions 與開發環境都遇到），先走鏡像
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google {
            // 只向 Google 的 Maven 要 Android 相關的套件，其他的走 Maven Central
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        // Maven Central 的 Google 鏡像：Maven Central 會限流（HTTP 429，2026-11-15 在 Actions 與開發環境都遇到），先走鏡像
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        mavenCentral()
    }
}

rootProject.name = "MultiView"

// :core 是純 Kotlin，不需要 Android SDK，可以在沒有 SDK 的開發環境直接跑測試（./gradlew :core:test）。
// :app 需要 Android SDK：有 ANDROID_HOME／ANDROID_SDK_ROOT 或 local.properties 的 sdk.dir 時才加入。
include(":core")

val hasAndroidSdk = System.getenv("ANDROID_HOME") != null ||
    System.getenv("ANDROID_SDK_ROOT") != null ||
    file("local.properties").let { it.exists() && it.readText().contains("sdk.dir") }
if (hasAndroidSdk) {
    include(":app")
} else {
    println("找不到 Android SDK，只建置 :core")
}
