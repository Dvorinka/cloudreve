package s3

import (
	"net/url"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	awss3 "github.com/aws/aws-sdk-go/service/s3"
	"github.com/cloudreve/Cloudreve/v4/ent"
	"github.com/stretchr/testify/require"
)

// Regression test for upstream cloudreve/cloudreve#3606: presigned part-upload
// URLs must sign only "host". Signing "content-length" makes Ceph RGW (and
// proxies that alter Content-Length) reject the browser PUT with 403.
func TestUploadPartURLSignsHostOnly(t *testing.T) {
	sess, err := session.NewSession(&aws.Config{
		Credentials:      credentials.NewStaticCredentials("akid", "secret", ""),
		Endpoint:         aws.String("https://s3.example.com"),
		Region:           aws.String("us-east-1"),
		S3ForcePathStyle: aws.Bool(true),
	})
	require.NoError(t, err)

	d := &Driver{
		policy: &ent.StoragePolicy{BucketName: "bucket"},
		svc:    awss3.New(sess),
	}

	raw, err := d.uploadPartURL("uploads/1/f.bin", "upload-id-1", 2, time.Hour)
	require.NoError(t, err)

	u, err := url.Parse(raw)
	require.NoError(t, err)
	q := u.Query()
	require.Equal(t, "host", q.Get("X-Amz-SignedHeaders"))
	require.Equal(t, "2", q.Get("partNumber"))
	require.Equal(t, "upload-id-1", q.Get("uploadId"))
}
