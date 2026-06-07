package com.shairee.portal

import android.os.Bundle
import android.content.Context
import android.net.wifi.WifiManager

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
}
