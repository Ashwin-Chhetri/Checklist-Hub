const IN_APP_BROWSER_PATTERNS = [
  /FBAN|FBAV/i, // Facebook
  /Instagram/i,
  /Line\//i,
  /MicroMessenger/i, // WeChat
  /TikTok|musical_ly|BytedanceWebview/i,
  /LinkedInApp/i,
  /Snapchat/i,
  /\bGSA\//i, // Google app's own in-app browser — also blocked by Google's OAuth policy
  /Outlook-(iOS|Android)/i,
  /; ?wv\)/i, // generic Android WebView marker
];

/**
 * True when the page is loaded inside a known in-app/webview browser
 * (Outlook, Facebook, Instagram, etc.) rather than the device's real
 * browser. Google's OAuth blocks sign-in from these user agents
 * ("disallowed_useragent"), so callers use this to steer users to open
 * the link in their actual browser before they hit "Sign in with Google".
 */
export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER_PATTERNS.some((pattern) => pattern.test(userAgent));
}
