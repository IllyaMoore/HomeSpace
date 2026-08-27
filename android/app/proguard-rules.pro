# kotlinx.serialization keeps its generated serializers via companion objects
# that R8 cannot see are reachable. These rules are the ones the library
# documents; without them a release build parses nothing and fails at runtime
# rather than at compile time.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class io.github.illyamoore.homespace.data.** {
    *** Companion;
}
-keepclasseswithmembers class io.github.illyamoore.homespace.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class io.github.illyamoore.homespace.data.**$$serializer { *; }

# OkHttp ships optional Conscrypt/Bouncy Castle hooks that R8 warns about.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
