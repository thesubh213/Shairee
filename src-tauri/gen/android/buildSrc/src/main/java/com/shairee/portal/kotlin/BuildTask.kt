import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val executable = "npm"
        try {
            runTauriCli(executable)
        } catch (e: Exception) {
            if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                // Try to find the npm executable in common absolute paths or search PATH manually
                val resolvedExecutable = findNpmOnWindows(executable) ?: executable
                try {
                    runTauriCli(resolvedExecutable)
                    return
                } catch (ex: Exception) {
                    // Fall back to trying standard extensions if absolute resolution didn't help
                    val fallbacks = listOf(
                        "$executable.cmd",
                        "$executable.exe",
                        "$executable.bat",
                    )
                    var lastException: Exception = ex
                    for (fallback in fallbacks) {
                        try {
                            runTauriCli(fallback)
                            return
                        } catch (fallbackException: Exception) {
                            lastException = fallbackException
                        }
                    }
                    throw lastException
                }
            } else {
                throw e
            }
        }
    }

    private fun findNpmOnWindows(baseName: String): String? {
        val paths = mutableListOf<File>()
        
        // System Program Files
        val programFiles = System.getenv("ProgramFiles") ?: "C:\\Program Files"
        paths.add(File(programFiles, "nodejs\\$baseName.cmd"))
        paths.add(File(programFiles, "nodejs\\$baseName.exe"))
        
        val programFilesX86 = System.getenv("ProgramFiles(x86)") ?: "C:\\Program Files (x86)"
        paths.add(File(programFilesX86, "nodejs\\$baseName.cmd"))
        paths.add(File(programFilesX86, "nodejs\\$baseName.exe"))

        // AppData and User Profile paths
        val userProfile = System.getenv("USERPROFILE")
        if (userProfile != null) {
            paths.add(File(userProfile, "AppData\\Roaming\\npm\\$baseName.cmd"))
            paths.add(File(userProfile, "scoop\\shims\\$baseName.cmd"))
        }
        
        val appData = System.getenv("APPDATA")
        if (appData != null) {
            paths.add(File(appData, "npm\\$baseName.cmd"))
        }

        val localAppData = System.getenv("LOCALAPPDATA")
        if (localAppData != null) {
            paths.add(File(localAppData, "Programs\\node\\$baseName.cmd"))
        }

        // Search in system PATH manually if it contains directories
        val envPath = System.getenv("PATH")
        if (envPath != null) {
            val cleanPath = envPath.replace("\"", "")
            for (dir in cleanPath.split(File.pathSeparator)) {
                if (dir.trim().isNotEmpty()) {
                    paths.add(File(dir.trim(), "$baseName.cmd"))
                    paths.add(File(dir.trim(), "$baseName.exe"))
                    paths.add(File(dir.trim(), "$baseName.bat"))
                }
            }
        }

        for (file in paths) {
            if (file.exists() && file.isFile) {
                return file.absolutePath
            }
        }
        return null
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = listOf("run", "--", "tauri", "android", "android-studio-script");

        project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            executable(executable)
            args(args)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}