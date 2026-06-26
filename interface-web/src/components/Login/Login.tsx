import { useState, useEffect } from 'react'
import { checkFirstRun, login, register } from '../../api/auth'
import { SUPPORTED_LANGS } from '../../types'

const LANG_FLAGS: Record<string, string> = {
  en: '🇬🇧', it: '🇮🇹', de: '🇩🇪', fr: '🇫🇷',
  es: '🇪🇸', pt: '🇵🇹', ru: '🇷🇺', ja: '🇯🇵', zh: '🇨🇳',
}

type S = {
  subtitle: string; myLang: string; readIn: string; translateTo: string
  username: string; password: string; signIn: string; createAccount: string
  firstTime: string; haveAccount: string; signInLink: string
  invalidCredentials: string; serverError: string; loading: string
}

const I18N: Record<string, S> = {
  en: {
    subtitle: 'Your reading companion',
    myLang: 'My language', readIn: 'I read in', translateTo: 'Translate to',
    username: 'Username', password: 'Password',
    signIn: 'Sign in', createAccount: 'Create account',
    firstTime: "First time? Create your account →",
    haveAccount: 'Already have an account?', signInLink: 'Sign in →',
    invalidCredentials: 'Invalid username or password.',
    serverError: 'Server error. Please try again.',
    loading: 'Please wait…',
  },
  it: {
    subtitle: 'Il tuo assistente di lettura',
    myLang: 'La mia lingua', readIn: 'Leggo in', translateTo: 'Traduco in',
    username: 'Nome utente', password: 'Password',
    signIn: 'Accedi', createAccount: 'Crea account',
    firstTime: "Prima volta? Crea il tuo account →",
    haveAccount: 'Hai già un account?', signInLink: 'Accedi →',
    invalidCredentials: 'Nome utente o password non validi.',
    serverError: 'Errore del server. Riprova.',
    loading: 'Attendere…',
  },
  de: {
    subtitle: 'Dein Lesebegleiter',
    myLang: 'Meine Sprache', readIn: 'Ich lese in', translateTo: 'Übersetze in',
    username: 'Benutzername', password: 'Passwort',
    signIn: 'Anmelden', createAccount: 'Konto erstellen',
    firstTime: "Zum ersten Mal? Konto erstellen →",
    haveAccount: 'Bereits ein Konto?', signInLink: 'Anmelden →',
    invalidCredentials: 'Ungültiger Benutzername oder Passwort.',
    serverError: 'Serverfehler. Bitte erneut versuchen.',
    loading: 'Bitte warten…',
  },
  fr: {
    subtitle: 'Votre compagnon de lecture',
    myLang: 'Ma langue', readIn: 'Je lis en', translateTo: 'Je traduis en',
    username: "Nom d'utilisateur", password: 'Mot de passe',
    signIn: 'Se connecter', createAccount: 'Créer un compte',
    firstTime: "Première fois ? Créer un compte →",
    haveAccount: 'Vous avez déjà un compte ?', signInLink: 'Se connecter →',
    invalidCredentials: "Nom d'utilisateur ou mot de passe invalide.",
    serverError: 'Erreur serveur. Veuillez réessayer.',
    loading: 'Veuillez patienter…',
  },
  es: {
    subtitle: 'Tu compañero de lectura',
    myLang: 'Mi idioma', readIn: 'Leo en', translateTo: 'Traduzco a',
    username: 'Usuario', password: 'Contraseña',
    signIn: 'Iniciar sesión', createAccount: 'Crear cuenta',
    firstTime: "¿Primera vez? Crear cuenta →",
    haveAccount: '¿Ya tienes cuenta?', signInLink: 'Iniciar sesión →',
    invalidCredentials: 'Usuario o contraseña incorrectos.',
    serverError: 'Error del servidor. Inténtalo de nuevo.',
    loading: 'Por favor espera…',
  },
  pt: {
    subtitle: 'Seu companheiro de leitura',
    myLang: 'Meu idioma', readIn: 'Leio em', translateTo: 'Traduzo para',
    username: 'Usuário', password: 'Senha',
    signIn: 'Entrar', createAccount: 'Criar conta',
    firstTime: "Primeira vez? Criar conta →",
    haveAccount: 'Já tem uma conta?', signInLink: 'Entrar →',
    invalidCredentials: 'Usuário ou senha inválidos.',
    serverError: 'Erro no servidor. Tente novamente.',
    loading: 'Por favor aguarde…',
  },
  ru: {
    subtitle: 'Ваш читательский помощник',
    myLang: 'Мой язык', readIn: 'Читаю на', translateTo: 'Перевожу на',
    username: 'Имя пользователя', password: 'Пароль',
    signIn: 'Войти', createAccount: 'Создать аккаунт',
    firstTime: "Первый раз? Создать аккаунт →",
    haveAccount: 'Уже есть аккаунт?', signInLink: 'Войти →',
    invalidCredentials: 'Неверное имя пользователя или пароль.',
    serverError: 'Ошибка сервера. Попробуйте снова.',
    loading: 'Пожалуйста, подождите…',
  },
  ja: {
    subtitle: '読書のお供',
    myLang: '私の言語', readIn: '読む言語', translateTo: '翻訳先',
    username: 'ユーザー名', password: 'パスワード',
    signIn: 'ログイン', createAccount: 'アカウント作成',
    firstTime: "初めてですか？アカウント作成 →",
    haveAccount: 'アカウントをお持ちですか？', signInLink: 'ログイン →',
    invalidCredentials: 'ユーザー名またはパスワードが無効です。',
    serverError: 'サーバーエラー。もう一度お試しください。',
    loading: 'しばらくお待ちください…',
  },
  zh: {
    subtitle: '您的阅读伴侣',
    myLang: '我的语言', readIn: '我阅读的语言', translateTo: '翻译为',
    username: '用户名', password: '密码',
    signIn: '登录', createAccount: '创建账户',
    firstTime: "第一次？创建账户 →",
    haveAccount: '已有账户？', signInLink: '登录 →',
    invalidCredentials: '用户名或密码无效。',
    serverError: '服务器错误，请重试。',
    loading: '请稍等…',
  },
}

interface Props {
  onLogin: (token: string, sourceLang: string, targetLang: string, uiLang: string) => void
}

export default function Login({ onLogin }: Props) {
  const [uiLang, setUiLang] = useState('en')
  const [sourceLang, setSourceLang] = useState('en')
  const [targetLang, setTargetLang] = useState('it')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [firstRun, setFirstRun] = useState<boolean | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const s = I18N[uiLang] ?? I18N.en
  const isCreate = firstRun === true || showCreate

  useEffect(() => {
    checkFirstRun().then(fr => {
      setFirstRun(fr)
      if (fr) setShowCreate(true)
    }).catch(() => setFirstRun(false))
  }, [])

  function handleUiLang(lang: string) {
    setUiLang(lang)
    // Auto-set targetLang to match chosen UI language
    setTargetLang(lang)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return
    setError('')
    setLoading(true)
    try {
      const token = isCreate
        ? await register(username.trim(), password)
        : await login(username.trim(), password)
      onLogin(token, sourceLang, targetLang, uiLang)
    } catch (err: unknown) {
      const msg = String((err as Error).message)
      if (msg === 'invalid') setError(s.invalidCredentials)
      else if (msg === 'exists') setError('Username already taken.')
      else setError(s.serverError)
    } finally {
      setLoading(false)
    }
  }

  const flagLangs = Object.keys(LANG_FLAGS)

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '40px 32px 32px',
        width: '100%',
        maxWidth: 380,
        boxShadow: '0 8px 40px rgba(0,0,0,0.10)',
      }}>

        {/* Flag row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 28 }}>
          {flagLangs.map(lang => (
            <button
              key={lang}
              onClick={() => handleUiLang(lang)}
              title={SUPPORTED_LANGS[lang] ?? lang}
              style={{
                background: uiLang === lang ? 'var(--hover)' : 'none',
                border: `2px solid ${uiLang === lang ? 'var(--accent)' : 'transparent'}`,
                borderRadius: 8,
                padding: '3px 5px',
                cursor: 'pointer',
                fontSize: 22,
                lineHeight: 1,
                transition: 'all 0.15s',
                opacity: uiLang === lang ? 1 : 0.5,
              }}
            >
              {LANG_FLAGS[lang]}
            </button>
          ))}
        </div>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Contexta</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{s.subtitle}</p>
        </div>

        {/* Translation pair */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {s.readIn}
            </label>
            <select
              className="form-input"
              value={sourceLang}
              onChange={e => setSourceLang(e.target.value)}
              style={{ width: '100%' }}
            >
              {Object.entries(SUPPORTED_LANGS).map(([code, name]) => (
                <option key={code} value={code}>{(LANG_FLAGS[code] ?? '') + ' ' + name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {s.translateTo}
            </label>
            <select
              className="form-input"
              value={targetLang}
              onChange={e => setTargetLang(e.target.value)}
              style={{ width: '100%' }}
            >
              {Object.entries(SUPPORTED_LANGS).map(([code, name]) => (
                <option key={code} value={code}>{(LANG_FLAGS[code] ?? '') + ' ' + name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Credentials form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            className="form-input"
            type="text"
            autoComplete="username"
            placeholder={s.username}
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{ width: '100%' }}
          />
          <input
            className="form-input"
            type="password"
            autoComplete={isCreate ? 'new-password' : 'current-password'}
            placeholder={s.password}
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ width: '100%' }}
          />
          {error && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)', textAlign: 'center' }}>{error}</p>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !username.trim() || !password.trim()}
            style={{ width: '100%', padding: '11px 0', fontSize: 15, marginTop: 4 }}
          >
            {loading ? s.loading : (isCreate ? s.createAccount : s.signIn)}
          </button>
        </form>

        {/* Toggle create / sign in */}
        {firstRun === false && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button
              onClick={() => { setShowCreate(v => !v); setError('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--accent)' }}
            >
              {showCreate ? `${s.haveAccount} ${s.signInLink}` : s.firstTime}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
