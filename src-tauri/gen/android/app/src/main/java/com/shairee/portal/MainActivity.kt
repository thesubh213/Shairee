package com.shairee.portal

import android.os.Bundle
import android.content.Context
import android.net.wifi.WifiManager
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore

import androidx.annotation.Keep

@Keep
class MainActivity : TauriActivity() {
    private var multicastLock: WifiManager.MulticastLock? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            multicastLock = wifi.createMulticastLock("ShaireeMulticastLock")
            multicastLock?.setReferenceCounted(true)
            multicastLock?.acquire()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            multicastLock?.let {
                if (it.isHeld) {
                    it.release()
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun copyContentUriToCache(uriString: String): String {
        try {
            val uri = Uri.parse(uriString)
            val contentResolver = applicationContext.contentResolver
            
            
            var fileName = "temp_" + System.currentTimeMillis()
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex != -1 && cursor.moveToFirst()) {
                    fileName = cursor.getString(nameIndex)
                }
            }
            
            
            fileName = File(fileName).name
            
            val cacheDir = applicationContext.cacheDir
            val destFile = File(cacheDir, fileName)
            
            
            contentResolver.openInputStream(uri)?.use { inputStream ->
                FileOutputStream(destFile).use { outputStream ->
                    inputStream.copyTo(outputStream)
                }
            }
            
            return destFile.absolutePath
        } catch (e: Exception) {
            e.printStackTrace()
            throw RuntimeException("Failed to resolve content URI: " + e.message)
        }
    }

    fun saveFileToPublicDownloads(cacheFilePath: String, fileName: String, mimeType: String?): String {
        val cacheFile = File(cacheFilePath)
        if (!cacheFile.exists()) {
            throw RuntimeException("Source cache file does not exist")
        }

        try {
            val resolver = applicationContext.contentResolver
            val finalUri: Uri?

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val contentValues = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    if (!mimeType.isNullOrEmpty()) {
                        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    }
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                finalUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
            } else {
                val publicDownloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!publicDownloadsDir.exists()) {
                    publicDownloadsDir.mkdirs()
                }
                val targetFile = File(publicDownloadsDir, fileName)
                var count = 1
                var uniqueFile = targetFile
                while (uniqueFile.exists()) {
                    val stem = targetFile.nameWithoutExtension
                    val ext = targetFile.extension
                    val extPart = if (ext.isNotEmpty()) ".$ext" else ""
                    uniqueFile = File(publicDownloadsDir, "$stem ($count)$extPart")
                    count++
                }
                
                cacheFile.copyTo(uniqueFile, overwrite = true)
                cacheFile.delete()
                return uniqueFile.absolutePath
            }

            if (finalUri == null) {
                throw RuntimeException("Failed to insert MediaStore record")
            }

            resolver.openOutputStream(finalUri)?.use { outputStream ->
                cacheFile.inputStream().use { inputStream ->
                    inputStream.copyTo(outputStream)
                }
            }
            
            cacheFile.delete()
            return finalUri.toString()
        } catch (e: Exception) {
            e.printStackTrace()
            throw RuntimeException("Failed to save to public downloads: " + e.message)
        }
    }
}
