/// <reference types="vite/client" />

/* No app secret belongs here. Anything named VITE_* is inlined into the client bundle at build
   time and readable in devtools, so the Gemini, Pollinations, Hugging Face and Stripe keys are
   plain server environment variables, read only by the functions in api/. */
