name: Atualizar base de cartões e publicar site

on:
  workflow_dispatch:
  schedule:
    # Verifica a fonte todos os dias às 07h17 no horário de Brasília (10h17 UTC).
    - cron: '17 10 * * *'
  push:
    branches: [main]

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: github-pages
  cancel-in-progress: true

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Baixar repositório
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Preparar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Instalar parser HTML
        run: npm install --no-save cheerio

      - name: Atualizar cartões a partir da fonte pública
        id: refresh
        continue-on-error: true
        run: node scripts/update-cards.mjs

      - name: Registrar resultado da atualização
        if: steps.refresh.outcome == 'failure'
        run: echo 'A leitura da fonte falhou ou a página mudou. A base existente foi mantida e o site continuará sendo publicado com os últimos dados válidos.'

      - name: Salvar atualização da base, se houver alterações
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add index.html
          if ! git diff --cached --quiet; then
            git commit -m "Atualiza base de cartões automaticamente"
            git push
          else
            echo "Nenhuma alteração na base."
          fi

      - name: Configurar GitHub Pages
        uses: actions/configure-pages@v5

      - name: Enviar arquivos para publicação
        uses: actions/upload-pages-artifact@v3
        with:
          path: .

  deploy:
    needs: update
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Publicar site
        id: deployment
        uses: actions/deploy-pages@v4
