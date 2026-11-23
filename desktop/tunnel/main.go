// drivelog-tunnel: 공유기 설정 없이 인터넷에서 이 PC로 들어오는 통로 (Tailscale Funnel 내장)
//
//   - 443   → 127.0.0.1:4430  (공개키 서버, TLS 그대로 전달)
//   - 8443  → 127.0.0.1:4443  (테슬라 텔레메트리 수신, 차량 인증서 확인을 위해 TLS 그대로 전달)
//   - 10000 → http://127.0.0.1:8090 (주행 기록 대시보드, HTTPS는 Tailscale이 처리)
//
// 상태는 <out>/tailscale-status.json 에, 인증서는 <out>/telemetry/server-chain.crt / server.key 에 기록한다.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"tailscale.com/ipn"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
)

type status struct {
	BackendState string   `json:"BackendState"`
	AuthURL      string   `json:"AuthURL"`
	DNSName      string   `json:"DNSName"`
	CertDomains  []string `json:"CertDomains"`
	Funnel       bool     `json:"Funnel"`
	NodeID       string   `json:"NodeID"`
	ServeApplied bool     `json:"ServeApplied"`
	CertOK       bool     `json:"CertOK"`
	Error        string   `json:"Error,omitempty"`
	UpdatedAt    int64    `json:"UpdatedAt"`
}

func writeAtomic(path string, data []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func main() {
	dir := flag.String("dir", "tailscale-state", "Tailscale 상태 저장 폴더")
	out := flag.String("out", ".", "상태/인증서를 쓸 폴더")
	hostname := flag.String("hostname", "drivelog", "Tailscale 장치 이름 (tesla 단어 금지)")
	flag.Parse()

	s := &tsnet.Server{
		Hostname: *hostname,
		Dir:      *dir,
		Logf:     func(string, ...any) {}, // 내부 로그는 숨김
		UserLogf: log.Printf,
	}
	if err := s.Start(); err != nil {
		log.Fatalf("tailscale 시작 실패: %v", err)
	}
	defer s.Close()
	lc, err := s.LocalClient()
	if err != nil {
		log.Fatalf("LocalClient 실패: %v", err)
	}

	statusFile := filepath.Join(*out, "tailscale-status.json")
	certFile := filepath.Join(*out, "telemetry", "server-chain.crt")
	keyFile := filepath.Join(*out, "telemetry", "server.key")
	var lastCert time.Time
	serveApplied := false
	appliedFor := ""

	for {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		st := status{UpdatedAt: time.Now().Unix()}
		ss, err := lc.StatusWithoutPeers(ctx)
		if err != nil {
			st.Error = err.Error()
		} else {
			st.BackendState = ss.BackendState
			st.AuthURL = ss.AuthURL
			st.CertDomains = ss.CertDomains
			if ss.Self != nil {
				st.DNSName = strings.TrimSuffix(ss.Self.DNSName, ".")
				st.NodeID = string(ss.Self.ID)
				st.Funnel = ss.Self.HasCap(tailcfg.NodeAttrFunnel)
			}
		}

		domain := ""
		if len(st.CertDomains) > 0 {
			domain = st.CertDomains[0]
		}

		// 인증서 (Let's Encrypt, *.ts.net) 발급/갱신: 12시간마다 확인
		if st.BackendState == "Running" && domain != "" && (time.Since(lastCert) > 12*time.Hour || !fileExists(certFile)) {
			certPEM, keyPEM, cerr := lc.CertPair(ctx, domain)
			if cerr != nil {
				st.Error = "인증서: " + cerr.Error()
			} else {
				lastCert = time.Now()
				old, _ := os.ReadFile(certFile)
				if !bytes.Equal(old, certPEM) {
					_ = writeAtomic(keyFile, keyPEM, 0o600)
					_ = writeAtomic(certFile, certPEM, 0o644)
					log.Printf("인증서 저장: %s", domain)
				}
			}
		}
		st.CertOK = fileExists(certFile)

		// Funnel 설정 (권한이 생기면 한 번 적용, 주소가 바뀌면 다시 적용)
		if st.BackendState == "Running" && domain != "" && st.Funnel && appliedFor != domain {
			hp := func(port string) ipn.HostPort { return ipn.HostPort(domain + ":" + port) }
			cfg := &ipn.ServeConfig{
				TCP: map[uint16]*ipn.TCPPortHandler{
					443:   {TCPForward: "127.0.0.1:4430"},
					8443:  {TCPForward: "127.0.0.1:4443"},
					10000: {HTTPS: true},
				},
				Web: map[ipn.HostPort]*ipn.WebServerConfig{
					hp("10000"): {Handlers: map[string]*ipn.HTTPHandler{"/": {Proxy: "http://127.0.0.1:8090"}}},
				},
				AllowFunnel: map[ipn.HostPort]bool{hp("443"): true, hp("8443"): true, hp("10000"): true},
			}
			if serr := lc.SetServeConfig(ctx, cfg); serr != nil {
				st.Error = "funnel: " + serr.Error()
			} else {
				serveApplied = true
				appliedFor = domain
				log.Printf("Funnel 적용: %s (443, 8443, 10000)", domain)
			}
		}
		st.ServeApplied = serveApplied
		cancel()

		if b, err := json.MarshalIndent(st, "", "  "); err == nil {
			_ = writeAtomic(statusFile, b, 0o644)
		}
		time.Sleep(5 * time.Second)
	}
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
