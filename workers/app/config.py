from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    redis_url: str = "redis://localhost:6379"

    anthropic_api_key: str
    openai_api_key: str

    r2_endpoint: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket: str = "patrulheiro"

    partido_sigla: str = "PARTIDO"
    worker_secret: str = "dev-secret"

    inlabs_user: str = ""
    inlabs_password: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
