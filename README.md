# 横浜市施設予約 空き監視

横浜市市民利用施設予約システムの「日時から探す」を、GitHub Actionsから5分間隔で確認します。前回結果に存在しなかった空きが検出されたときだけ、SlackまたはDiscordのWebhookに通知します。予約・申込操作は実行しません。

## 今回の検索条件

GitHub Actionsは、毎回JSTの本日を開始日として、本日から29日先まで検索します。したがって通知対象は、**本日以降**です。予約用の「本日から5日以上先」という条件は、GitHub通知側には適用しません。

検索は結果上限対策のため、次の2種類に分けています。

| 検索 | 利用時間 | 曜日 | 施設 |
|---|---|---|---|
| Weekend and holiday | 09:00-21:00 | 土曜日・日曜日・祝日 | 新横浜公園、都田公園、長坂谷公園第一、長坂谷公園第二 |
| All weekdays evening | 19:00-21:00 | 月曜日-日曜日 | 新横浜公園 |

土日祝日検索は4施設、平日夜間検索は新横浜公園だけです。横浜国際プールは対象外です。

## セットアップ

1. このディレクトリをGitHubリポジトリのルートへコピーします。
2. GitHubの **Settings → Secrets and variables → Actions → Variables** に次の変数を登録します。
3. **Secrets** に `NOTIFY_WEBHOOK_URL` を登録します。SlackならIncoming Webhook、DiscordならWebhook URLです。
4. `NOTIFY_KIND` は `slack` または `discord` にします。
5. Actionsのワークフロー実行権限で、`Read and write permissions` を有効にします。`state-weekend.json`と`state-evening.json`をコミットして差分判定に使います。
6. `workflow_dispatch`で手動実行し、検索期間が本日から始まっていることを確認します。

## Variables

| 変数 | 例 | 内容 |
|---|---|---|
| `USAGE_CATEGORY` | `スポーツ` | 利用目的分類 |
| `USAGE_PURPOSE` | `テニス` | サイト上の利用目的名と完全一致させる |
| `SEARCH_TARGET` | `空きコマ` | 検索対象 |
| `AREAS` | `港北区,都筑区,青葉区,緑区` | 検索する区 |
| `NOTIFY_KIND` | `discord` | 通知先の形式 |

`FROM_DATE`、`TO_DATE`、`FROM_TIME`、`TO_TIME`、`WEEKDAYS`、`FACILITIES`はワークフローが検索ごとに設定します。GitHub Variablesに登録した施設名は使用せず、土日祝日は対象4施設、平日夜間は新横浜公園だけをワークフロー内で固定しています。

## GitHub上で変更する箇所

既存リポジトリを直接更新する場合は、次のファイルを置き換えます。

```text
.github/workflows/check.yml
README.md
```

今回の変更後、`.github/workflows/check.yml`の`Set search dates`には次の処理が入っています。

```bash
TODAY=$(TZ=Asia/Tokyo date +%F)
TO_DATE=$(TZ=Asia/Tokyo date -d "+29 days" +%F)
echo "FROM_DATE=$TODAY" >> "$GITHUB_ENV"
echo "TO_DATE=$TO_DATE" >> "$GITHUB_ENV"
```

このため、日付を毎日手動で変更する必要はありません。

## 注意

対象サイトに過度な負荷をかけないよう、GitHub Actionsの実行間隔は5分です。スケジュール実行は混雑などで遅延することがあります。また、サイトの画面構成変更によりセレクタや空き判定の調整が必要になる場合があります。

このプログラムは公開画面の検索だけを行い、ログイン情報を扱いません。予約操作は実行しません。
