# 🎯 DeadCode Radar

> Análisis estático, afilado por IA. Encuentra código muerto en tu repo antes de que él te encuentre.

**[🚀 Pruébalo en vivo](https://d30fivs2ylbran.cloudfront.net)** · **[📹 Ver la demo](LINK_AL_VIDEO)**

![Vista principal de DeadCode Radar](images/DeadCodeRadar_home.png)

## Qué hace

DeadCode Radar analiza cualquier repositorio público de GitHub en busca de archivos, exports y 
dependencias sin usar — y usa IA para explicar *por qué* cada hallazgo es (o no) un candidato 
seguro de eliminación, detectando falsos positivos que las herramientas de análisis estático 
puro no ven.

## Por qué es diferente

El análisis estático puro es ruidoso: marca handlers de rutas de Next.js, módulos cargados 
dinámicamente, y APIs re-exportadas como "muertos" cuando no lo son. DeadCode Radar enriquece 
cada hallazgo con un nivel de confianza y una explicación de riesgo en lenguaje claro — y, para 
los casos donde realmente tiene confianza, puede abrir un Pull Request real que elimina el 
código muerto por ti.

## Cómo funciona

1. **Pega la URL de un repo** — repositorios públicos de GitHub, JS/TypeScript
2. **Análisis estático** (knip/ts-prune) genera la lista cruda de archivos, exports y 
   dependencias sin usar
3. **Amazon Bedrock (Claude)** lee el contexto real de cada archivo, asigna un nivel de 
   confianza (alto/medio/bajo), agrupa hallazgos relacionados, y redacta una descripción de PR
4. **Crea un PR real** — con tu propio token de GitHub, DeadCode Radar abre un Pull Request 
   que elimina solo el código muerto de alta confianza y sin ambigüedad, dejando lo incierto 
   para revisión manual

## Arquitectura
![Diagrama de arquitectura](images/deadcode_radar_architecture.png)

- **AWS Lambda** — backend serverless, Node.js/TypeScript
- **Amazon Bedrock (Claude Sonnet)** — capa de enriquecimiento con IA
- **DynamoDB** — almacenamiento de resultados
- **S3 + CloudFront** — hosting del frontend
- **GitHub API (Octokit)** — descarga de repos + creación de PR

## Construido con Kiro

Todo este proyecto se construyó usando el flujo spec-driven de Kiro (requirements → design → 
tasks) a lo largo de dos días de desarrollo, más Claude Code para depuración iterativa y 
refinamiento de UI.

## Limitaciones conocidas

- La detección de `unused-dependency` requiere que el repo analizado tenga `node_modules` 
  instalado para que knip pueda resolverlo correctamente — actualmente no soportado para 
  repos remotos analizados sin un paso completo de instalación
- Los niveles de confianza para la creación de PR son generados por IA y pueden variar 
  ligeramente entre corridas sobre el mismo repo (no-determinismo del LLM) — el sistema es 
  intencionalmente conservador: ante la duda, no toca el archivo
- Actualmente solo soporta JavaScript/TypeScript

## Roadmap

- Login con GitHub OAuth (en vez de entrada manual de token)
- Soporte multi-lenguaje (Python, Go)
- Creación de PR vía fork para repos que no son tuyos

## Instalación local

### Prerequisites
- Node.js 20.x
- AWS CLI configured with credentials that have permissions for Lambda, 
  DynamoDB, IAM, and Bedrock
- AWS CDK installed globally: `npm install -g aws-cdk`
- A GitHub Personal Access Token (classic, `public_repo` scope is enough 
  for analysis; `repo` scope needed if you want to test PR creation)
- Access to Amazon Bedrock enabled in your AWS account/region for the 
  Claude model used (`us.anthropic.claude-sonnet-4-6` inference profile)

### Option A — Run the frontend only (points to our live backend)

The fastest way to try the UI locally without deploying any AWS 
infrastructure:

\`\`\`bash
git clone https://github.com/MaxTheHuman21/DeadCodeRadar.git
cd DeadCodeRadar/frontend
npm install

# .env already points to our deployed backend by default
npm run dev
\`\`\`

Open `http://localhost:5173` — the app will hit our live Lambda backend.

### Option B — Full deploy (backend + frontend on your own AWS account)

\`\`\`bash
git clone https://github.com/MaxTheHuman21/DeadCodeRadar.git
cd DeadCodeRadar

# 1. Install backend dependencies
npm install

# 2. Bootstrap CDK (only needed once per AWS account/region)
cdk bootstrap

# 3. Set your GitHub token as an environment variable
export GITHUB_TOKEN=your_github_personal_access_token

# 4. Deploy the backend (Lambda, DynamoDB, Bedrock permissions)
cdk deploy

# Note the FunctionUrl output — you'll need it for the frontend

# 5. Configure and run the frontend
cd frontend
npm install

# Create a .env file with your deployed Function URL:
echo "VITE_API_URL=<your-function-url-from-step-4>" > .env

npm run dev       # local dev server
# — or —
npm run build     # production build, output in dist/
\`\`\`

### Running tests

\`\`\`bash
npx tsc --noEmit      # type check
npx vitest --run      # unit + property-based tests
cdk synth             # validate CloudFormation template
\`\`\`

### Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Yes (backend deploy) | GitHub PAT used as fallback for public repo analysis |
| `VITE_API_URL` | Yes (frontend) | Backend Function URL (from CDK output) |