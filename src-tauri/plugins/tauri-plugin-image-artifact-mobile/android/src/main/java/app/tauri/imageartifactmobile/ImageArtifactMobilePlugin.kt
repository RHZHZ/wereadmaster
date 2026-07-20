package app.tauri.imageartifactmobile

import android.app.Activity
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.util.Locale

@InvokeArg
class ImageArtifactPayload {
  lateinit var fileName: String
  lateinit var pngDataUrl: String
}

@TauriPlugin
class ImageArtifactMobilePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun getCapabilities(invoke: Invoke) {
    val result = JSObject()
    result.put("canSaveToAlbum", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
    result.put("canShareImage", true)
    invoke.resolve(result)
  }

  @Command
  fun saveImageToAlbum(invoke: Invoke) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      invoke.reject(
        "当前 Android 版本不支持直接保存到相册，请改用分享或导出文件。",
        "image_artifact_album_unavailable"
      )
      return
    }

    try {
      val args = invoke.parseArgs(ImageArtifactPayload::class.java)
      val fileName = normalizePngFileName(args.fileName)
      val pngBytes = decodePng(args.pngDataUrl)
      val resolver = activity.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
        put(
          MediaStore.Images.Media.RELATIVE_PATH,
          "${Environment.DIRECTORY_PICTURES}/${albumName()}"
        )
        put(MediaStore.Images.Media.IS_PENDING, 1)
      }
      val imageUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        ?: throw IllegalStateException("无法创建相册图片条目。")

      try {
        resolver.openOutputStream(imageUri)?.use { output ->
          output.write(pngBytes)
        } ?: throw IllegalStateException("无法写入相册图片。")

        values.clear()
        values.put(MediaStore.Images.Media.IS_PENDING, 0)
        resolver.update(imageUri, values, null, null)
      } catch (ex: Exception) {
        resolver.delete(imageUri, null, null)
        throw ex
      }

      invoke.resolve(deliveryResult(fileName, "album"))
    } catch (ex: Exception) {
      invoke.reject(
        ex.message ?: "保存到相册失败。",
        "image_artifact_save_failed",
        ex
      )
    }
  }

  @Command
  fun shareImage(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ImageArtifactPayload::class.java)
      val fileName = normalizePngFileName(args.fileName)
      val pngBytes = decodePng(args.pngDataUrl)
      val imageFile = writeTempShareImage(fileName, pngBytes)
      val imageUri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.fileprovider",
        imageFile
      )
      val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, imageUri)
        putExtra(Intent.EXTRA_TITLE, fileName)
        clipData = ClipData.newUri(activity.contentResolver, fileName, imageUri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(sendIntent, fileName)
      activity.startActivity(chooser)

      invoke.resolve(deliveryResult(fileName, "shareSheet"))
    } catch (ex: Exception) {
      invoke.reject(
        ex.message ?: "打开系统分享失败。",
        "image_artifact_share_failed",
        ex
      )
    }
  }

  private fun albumName(): String = activity.applicationInfo.loadLabel(activity.packageManager).toString()
    .ifBlank { "WxReadMaster" }

  private fun deliveryResult(fileName: String, source: String): JSObject {
    val result = JSObject()
    result.put("fileName", fileName)
    result.put("source", source)
    result.put("cancelled", false)
    return result
  }

  private fun writeTempShareImage(fileName: String, pngBytes: ByteArray): File {
    val dir = File(activity.cacheDir, "image-artifacts")
    if (!dir.exists()) {
      dir.mkdirs()
    }

    val file = File(dir, fileName)
    FileOutputStream(file).use { output ->
      output.write(pngBytes)
    }
    return file
  }

  private fun decodePng(pngDataUrl: String): ByteArray {
    val payload = pngDataUrl.substringAfter("base64,", pngDataUrl).trim()
    val bytes = Base64.decode(payload, Base64.DEFAULT)
    if (!bytes.startsWith(PNG_SIGNATURE)) {
      throw IllegalArgumentException("图片内容不是有效的 PNG 数据。")
    }
    return bytes
  }

  private fun normalizePngFileName(fileName: String): String {
    val trimmed = fileName.trim().ifBlank { "reading-report.png" }
    val safe = trimmed
      .replace(Regex("""[\\/:*?"<>|]"""), "-")
      .replace(Regex("""\s+"""), " ")
      .take(120)
      .trim(' ', '.', '-')
      .ifBlank { "reading-report.png" }

    return if (safe.lowercase(Locale.ROOT).endsWith(".png")) safe else "$safe.png"
  }

  private fun ByteArray.startsWith(prefix: ByteArray): Boolean {
    if (size < prefix.size) {
      return false
    }

    return prefix.indices.all { index -> this[index] == prefix[index] }
  }

  companion object {
    private val PNG_SIGNATURE = byteArrayOf(
      0x89.toByte(),
      0x50,
      0x4E,
      0x47,
      0x0D,
      0x0A,
      0x1A,
      0x0A
    )
  }
}
