package local.multiview.core

/** 成功或失敗的結果（對照 Swift 的 Result）。 */
sealed class Outcome<out T, out E> {
    data class Ok<T>(val value: T) : Outcome<T, Nothing>()
    data class Err<E>(val error: E) : Outcome<Nothing, E>()

    fun valueOrNull(): T? = (this as? Ok)?.value

    fun errorOrNull(): E? = (this as? Err)?.error
}
