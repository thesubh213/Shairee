package com.shairee.portal

import android.os.Bundle
import android.content.Context
import android.net.wifi.WifiManager
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream

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
            
            // Query metadata (filename)
            var fileName = "temp_" + System.currentTimeMillis()
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex != -1 && cursor.moveToFirst()) {
                    fileName = cursor.getString(nameIndex)
                }
            }
            
            // Clean filename to prevent path traversal
            fileName = File(fileName).name
            
            val cacheDir = applicationContext.cacheDir
            val destFile = File(cacheDir, fileName)
            
            // Copy data from content resolver stream to cache file
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
}
